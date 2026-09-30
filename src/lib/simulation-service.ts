import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CertForgeDatabase } from "./db";
import { isCorrectAnswer } from "./evaluation";
import { selectQuestions, type SelectableQuestion } from "./selection";
import type { SimulationMode, SimulationView, SnapshotQuestion } from "./types";

export const createSimulationSchema = z.object({
  mode: z.enum(["training", "exam"]),
  questionCount: z.number().int().positive(),
  bankIds: z.array(z.string()).default([]),
  certification: z.string().optional(),
  domain: z.string().optional(),
  topic: z.string().optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
});
export type CreateSimulationInput = z.infer<typeof createSimulationSchema>;

interface PoolRow extends SelectableQuestion {
  bankTitle: string;
  certificationName: string;
  certificationCode: string;
  topic: string;
  difficulty: string;
  type: "single-choice" | "multiple-choice";
  text: string;
  explanation: string;
  referenceTitle: string | null;
  referenceUrl: string | null;
  correctAnswersJson: string;
}

function getPool(db: CertForgeDatabase, input: Pick<CreateSimulationInput, "bankIds" | "certification" | "domain" | "topic">): PoolRow[] {
  const rows = db.prepare(`
    SELECT q.bank_id AS bankId, q.bank_version AS bankVersion, q.question_id AS questionId,
      q.domain, q.topic, q.difficulty, q.type, q.text, q.explanation,
      q.reference_title AS referenceTitle, q.reference_url AS referenceUrl,
      q.correct_answers_json AS correctAnswersJson, b.title AS bankTitle,
      b.certification_name AS certificationName, b.certification_code AS certificationCode
    FROM questions q
    JOIN question_banks b ON b.id = q.bank_id AND b.current_version = q.bank_version
  `).all() as PoolRow[];
  return rows.filter((row) =>
    (!input.bankIds.length || input.bankIds.includes(row.bankId)) &&
    (!input.certification || row.certificationCode === input.certification) &&
    (!input.domain || row.domain === input.domain) &&
    (!input.topic || row.topic === input.topic)
  );
}

function snapshotQuestion(db: CertForgeDatabase, row: PoolRow): SnapshotQuestion {
  const answers = db.prepare(`SELECT option_id AS id, text FROM question_options WHERE bank_id = ? AND bank_version = ? AND question_id = ? ORDER BY display_order`)
    .all(row.bankId, row.bankVersion, row.questionId) as { id: string; text: string }[];
  return {
    bankTitle: row.bankTitle,
    certification: { name: row.certificationName, code: row.certificationCode },
    id: row.questionId,
    domain: row.domain,
    topic: row.topic,
    difficulty: row.difficulty,
    type: row.type,
    question: row.text,
    answers,
    correctAnswers: JSON.parse(row.correctAnswersJson) as string[],
    explanation: row.explanation,
    ...(row.referenceTitle && row.referenceUrl ? { learnReference: { title: row.referenceTitle, url: row.referenceUrl } } : {}),
  };
}

export function createSimulation(db: CertForgeDatabase, rawInput: unknown): string {
  const input = createSimulationSchema.parse(rawInput);
  const pool = getPool(db, input);
  const selected = selectQuestions(pool, input.questionCount);
  const id = randomUUID();
  const now = new Date().toISOString();
  const durationSeconds = input.mode === "exam" ? (input.durationMinutes ?? Math.max(5, Math.ceil(input.questionCount * 1.5))) * 60 : null;
  const certifications = [...new Set(selected.map((question) => question.certificationCode))];
  const write = db.transaction(() => {
    db.prepare(`INSERT INTO simulations (id, mode, status, created_at, started_at, duration_limit_seconds, current_position, certification_codes, filters_json) VALUES (?, ?, 'in-progress', ?, ?, ?, 0, ?, ?)`)
      .run(id, input.mode, now, now, durationSeconds, JSON.stringify(certifications), JSON.stringify(input));
    const insert = db.prepare(`INSERT INTO simulation_questions (simulation_id, position, source_bank_id, source_bank_version, source_question_id, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)`);
    selected.forEach((question, position) => insert.run(id, position, question.bankId, question.bankVersion, question.questionId, JSON.stringify(snapshotQuestion(db, question))));
  });
  write();
  return id;
}

interface SimulationRow {
  id: string; mode: SimulationMode; status: "in-progress" | "completed"; created_at: string; started_at: string;
  completed_at: string | null; duration_limit_seconds: number | null; current_position: number;
}
interface QuestionRow { position: number; snapshot_json: string; is_locked: number; is_correct: number | null; for_review: number }

function hasExpired(row: SimulationRow): boolean {
  return row.mode === "exam" && row.status === "in-progress" && row.duration_limit_seconds !== null && Date.now() >= new Date(row.started_at).getTime() + row.duration_limit_seconds * 1000;
}

export function getSimulation(db: CertForgeDatabase, id: string): SimulationView | null {
  let row = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id) as SimulationRow | undefined;
  if (!row) return null;
  if (hasExpired(row)) {
    submitSimulation(db, id);
    row = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id) as SimulationRow;
  }
  const questionRows = db.prepare("SELECT position, snapshot_json, is_locked, is_correct, for_review FROM simulation_questions WHERE simulation_id = ? ORDER BY position").all(id) as QuestionRow[];
  const answerRows = db.prepare("SELECT position, option_id FROM simulation_answers WHERE simulation_id = ? ORDER BY option_id").all(id) as { position: number; option_id: string }[];
  return {
    id: row.id, mode: row.mode, status: row.status, createdAt: row.created_at, startedAt: row.started_at,
    completedAt: row.completed_at, durationLimitSeconds: row.duration_limit_seconds, currentPosition: row.current_position,
    questions: questionRows.map((question) => ({
      position: question.position,
      question: JSON.parse(question.snapshot_json) as SnapshotQuestion,
      selectedAnswers: answerRows.filter((answer) => answer.position === question.position).map((answer) => answer.option_id),
      locked: Boolean(question.is_locked), correct: question.is_correct === null ? null : Boolean(question.is_correct), forReview: Boolean(question.for_review),
    })),
  };
}

function assertInProgress(db: CertForgeDatabase, id: string): SimulationRow {
  const row = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id) as SimulationRow | undefined;
  if (!row) throw new Error("Simulation not found");
  if (row.status !== "in-progress") throw new Error("Simulation is already complete");
  if (hasExpired(row)) { submitSimulation(db, id); throw new Error("Time expired; the exam was submitted"); }
  return row;
}

export function saveAnswers(db: CertForgeDatabase, id: string, position: number, answers: string[]): void {
  const simulation = assertInProgress(db, id);
  const question = db.prepare("SELECT snapshot_json, is_locked FROM simulation_questions WHERE simulation_id = ? AND position = ?").get(id, position) as { snapshot_json: string; is_locked: number } | undefined;
  if (!question) throw new Error("Question not found");
  if (question.is_locked) throw new Error("This answer is locked");
  const snapshot = JSON.parse(question.snapshot_json) as SnapshotQuestion;
  const valid = new Set(snapshot.answers.map((answer) => answer.id));
  if (answers.some((answer) => !valid.has(answer))) throw new Error("An answer option is invalid");
  if (snapshot.type === "single-choice" && answers.length > 1) throw new Error("Select only one answer");
  const unique = [...new Set(answers)];
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM simulation_answers WHERE simulation_id = ? AND position = ?").run(id, position);
    const insert = db.prepare("INSERT INTO simulation_answers (simulation_id, position, option_id, selected_at) VALUES (?, ?, ?, ?)");
    unique.forEach((answer) => insert.run(id, position, answer, now));
    if (simulation.current_position !== position) db.prepare("UPDATE simulations SET current_position = ? WHERE id = ?").run(position, id);
  })();
}

export function setCurrentPosition(db: CertForgeDatabase, id: string, position: number): void {
  assertInProgress(db, id);
  const exists = db.prepare("SELECT 1 FROM simulation_questions WHERE simulation_id = ? AND position = ?").get(id, position);
  if (!exists) throw new Error("Question not found");
  db.prepare("UPDATE simulations SET current_position = ? WHERE id = ?").run(position, id);
}

export function setReviewFlag(db: CertForgeDatabase, id: string, position: number, value: boolean): void {
  const simulation = assertInProgress(db, id);
  if (simulation.mode !== "exam") throw new Error("Review flags are only available in exam mode");
  const result = db.prepare("UPDATE simulation_questions SET for_review = ? WHERE simulation_id = ? AND position = ?").run(value ? 1 : 0, id, position);
  if (!result.changes) throw new Error("Question not found");
}

export function confirmTrainingAnswer(db: CertForgeDatabase, id: string, position: number): boolean {
  const simulation = assertInProgress(db, id);
  if (simulation.mode !== "training") throw new Error("Answers are confirmed only in training mode");
  const question = db.prepare("SELECT snapshot_json, is_locked FROM simulation_questions WHERE simulation_id = ? AND position = ?").get(id, position) as { snapshot_json: string; is_locked: number } | undefined;
  if (!question) throw new Error("Question not found");
  if (question.is_locked) throw new Error("This answer is already locked");
  const answers = db.prepare("SELECT option_id FROM simulation_answers WHERE simulation_id = ? AND position = ?").all(id, position) as { option_id: string }[];
  if (!answers.length) throw new Error("Select at least one answer before confirming");
  const snapshot = JSON.parse(question.snapshot_json) as SnapshotQuestion;
  const correct = isCorrectAnswer(answers.map((answer) => answer.option_id), snapshot.correctAnswers);
  db.prepare("UPDATE simulation_questions SET is_locked = 1, is_correct = ? WHERE simulation_id = ? AND position = ?").run(correct ? 1 : 0, id, position);
  return correct;
}

export function submitSimulation(db: CertForgeDatabase, id: string): void {
  const simulation = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id) as SimulationRow | undefined;
  if (!simulation) throw new Error("Simulation not found");
  if (simulation.status === "completed") return;
  const questions = db.prepare("SELECT position, snapshot_json FROM simulation_questions WHERE simulation_id = ?").all(id) as { position: number; snapshot_json: string }[];
  let correctCount = 0;
  db.transaction(() => {
    const update = db.prepare("UPDATE simulation_questions SET is_locked = 1, is_correct = ? WHERE simulation_id = ? AND position = ?");
    for (const row of questions) {
      const snapshot = JSON.parse(row.snapshot_json) as SnapshotQuestion;
      const answers = db.prepare("SELECT option_id FROM simulation_answers WHERE simulation_id = ? AND position = ?").all(id, row.position) as { option_id: string }[];
      const correct = isCorrectAnswer(answers.map((answer) => answer.option_id), snapshot.correctAnswers);
      if (correct) correctCount++;
      update.run(correct ? 1 : 0, id, row.position);
    }
    const score = questions.length ? (correctCount / questions.length) * 100 : 0;
    db.prepare("UPDATE simulations SET status = 'completed', completed_at = ?, score_percent = ? WHERE id = ?").run(new Date().toISOString(), score, id);
  })();
}

export function getCatalog(db: CertForgeDatabase) {
  const banks = db.prepare(`SELECT id, title, certification_name AS certificationName, certification_code AS certificationCode, current_version AS version, (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id AND q.bank_version = b.current_version) AS questionCount FROM question_banks b ORDER BY certification_code, title`).all();
  const rows = db.prepare(`SELECT DISTINCT b.certification_name AS certificationName, b.certification_code AS certificationCode, q.domain, q.topic FROM questions q JOIN question_banks b ON b.id = q.bank_id AND b.current_version = q.bank_version ORDER BY b.certification_code, q.domain, q.topic`).all();
  const inventory = db.prepare(`SELECT q.bank_id AS bankId, b.certification_code AS certificationCode, q.domain, q.topic FROM questions q JOIN question_banks b ON b.id = q.bank_id AND b.current_version = q.bank_version`).all();
  return { banks, facets: rows, inventory };
}
