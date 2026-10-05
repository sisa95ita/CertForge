import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EntityManager } from "typeorm";
import { withDatabase, type CertForgeDatabase } from "./db";
import { QuestionBankEntity, QuestionEntity, QuestionOptionEntity, SimulationEntity, SimulationQuestionEntity, SimulationAnswerEntity, type Question, type Simulation } from "./persistence/entities";
import { evaluateAnswer, evaluationFromScore } from "./evaluation";
import { selectQuestions, shuffled, type SelectableQuestion } from "./selection";
import type { SimulationView, SnapshotQuestion, EvaluationResult } from "./types";

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

interface PoolRow extends SelectableQuestion { question: Question; bankTitle: string; certificationName: string; certificationCode: string }
async function getPool(db: CertForgeDatabase, input: Pick<CreateSimulationInput, "bankIds" | "certification" | "domain" | "topic">): Promise<PoolRow[]> {
  const questions = await db.getRepository(QuestionEntity).createQueryBuilder("q")
    .innerJoinAndSelect("q.version", "v")
    .innerJoinAndSelect("v.bank", "b", "b.current_version = q.bank_version")
    .getMany();
  return questions.map((question) => ({
    bankId: question.bank_id, bankVersion: question.bank_version, questionId: question.question_id, domain: question.domain,
    question, bankTitle: question.version!.bank!.title, certificationName: question.version!.bank!.certification_name, certificationCode: question.version!.bank!.certification_code,
  })).filter((row) =>
    (!input.bankIds.length || input.bankIds.includes(row.bankId)) &&
    (!input.certification || row.certificationCode === input.certification) &&
    (!input.domain || row.domain === input.domain) &&
    (!input.topic || row.question.topic === input.topic)
  );
}

async function snapshotQuestion(manager: EntityManager, row: PoolRow, random: () => number): Promise<SnapshotQuestion> {
  const options = await manager.getRepository(QuestionOptionEntity).find({
    where: { bank_id: row.bankId, bank_version: row.bankVersion, question_id: row.questionId }, order: { display_order: "ASC" },
  });
  const q = row.question;
  return {
    bankTitle: row.bankTitle, certification: { name: row.certificationName, code: row.certificationCode },
    id: row.questionId, domain: row.domain, topic: q.topic, difficulty: q.difficulty, type: q.type, question: q.text,
    answers: shuffled(options.map((answer) => ({ id: answer.option_id, text: answer.text })), random),
    correctAnswers: q.correct_answers_json, explanation: q.explanation,
    ...(q.reference_title && q.reference_url ? { learnReference: { title: q.reference_title, url: q.reference_url } } : {}),
  };
}

async function createSimulationOperation(db: CertForgeDatabase, rawInput: unknown, random: () => number): Promise<string> {
  const input = createSimulationSchema.parse(rawInput);
  const selected = selectQuestions(await getPool(db, input), input.questionCount, random);
  const id = randomUUID();
  const now = new Date().toISOString();
  const durationSeconds = input.mode === "exam" ? (input.durationMinutes ?? Math.max(5, Math.ceil(input.questionCount * 1.5))) * 60 : null;
  const certifications = [...new Set(selected.map((question) => question.certificationCode))];
  await db.transaction(async (manager) => {
    await manager.getRepository(SimulationEntity).insert({ id, mode: input.mode, status: "in-progress", created_at: now, started_at: now, duration_limit_seconds: durationSeconds, current_position: 0, certification_codes: certifications, filters_json: input });
    for (const [position, question] of selected.entries()) {
      await manager.getRepository(SimulationQuestionEntity).insert({ simulation_id: id, position, source_bank_id: question.bankId, source_bank_version: question.bankVersion, source_question_id: question.questionId, snapshot_json: await snapshotQuestion(manager, question, random) });
    }
  });
  return id;
}

async function retrySimulationOperation(db: CertForgeDatabase, originalId: string, random: () => number): Promise<string> {
  const original = await db.getRepository(SimulationEntity).findOneBy({ id: originalId });
  if (!original) throw new Error("Simulation not found");
  if (original.status !== "completed") throw new Error("Only completed simulations can be retried");
  const questions = await db.getRepository(SimulationQuestionEntity).find({ where: { simulation_id: originalId }, order: { position: "ASC" } });
  if (!questions.length) throw new Error("Simulation has no questions");
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.transaction(async (manager) => {
    await manager.getRepository(SimulationEntity).insert({ id, mode: original.mode, status: "in-progress", created_at: now, started_at: now, duration_limit_seconds: original.duration_limit_seconds, current_position: 0, certification_codes: original.certification_codes, filters_json: original.filters_json, retried_from_simulation_id: originalId });
    for (const [position, row] of shuffled(questions, random).entries()) {
      const snapshot = row.snapshot_json;
      snapshot.answers = shuffled(snapshot.answers, random);
      await manager.getRepository(SimulationQuestionEntity).insert({ simulation_id: id, position, source_bank_id: row.source_bank_id, source_bank_version: row.source_bank_version, source_question_id: row.source_question_id, snapshot_json: snapshot });
    }
  });
  return id;
}

function hasExpired(row: Simulation): boolean {
  return row.mode === "exam" && row.status === "in-progress" && row.duration_limit_seconds !== null && Date.now() >= new Date(row.started_at).getTime() + row.duration_limit_seconds * 1000;
}

async function getSimulationOperation(db: CertForgeDatabase, id: string): Promise<SimulationView | null> {
  let row = await db.getRepository(SimulationEntity).findOneBy({ id });
  if (!row) return null;
  if (hasExpired(row)) {
    await submitSimulationOperation(db, id);
    row = (await db.getRepository(SimulationEntity).findOneBy({ id }))!;
  }
  const questionRows = await db.getRepository(SimulationQuestionEntity).find({ where: { simulation_id: id }, order: { position: "ASC" } });
  const answerRows = await db.getRepository(SimulationAnswerEntity).find({ where: { simulation_id: id }, order: { option_id: "ASC" } });
  return {
    id: row.id, mode: row.mode, status: row.status, createdAt: row.created_at, startedAt: row.started_at,
    completedAt: row.completed_at, durationLimitSeconds: row.duration_limit_seconds, currentPosition: row.current_position, retriedFromSimulationId: row.retried_from_simulation_id,
    questions: questionRows.map((question) => ({
      position: question.position, question: question.snapshot_json,
      selectedAnswers: answerRows.filter((answer) => answer.position === question.position).map((answer) => answer.option_id),
      evaluation: question.score_contribution === null ? null : evaluationFromScore(question.score_contribution),
      locked: question.is_locked, correct: question.is_correct, forReview: question.for_review,
    })),
  };
}

async function assertInProgress(db: CertForgeDatabase, id: string): Promise<Simulation> {
  const row = await db.getRepository(SimulationEntity).findOneBy({ id });
  if (!row) throw new Error("Simulation not found");
  if (row.status !== "in-progress") throw new Error("Simulation is already complete");
  if (hasExpired(row)) { await submitSimulationOperation(db, id); throw new Error("Time expired; the exam was submitted"); }
  return row;
}

async function saveAnswersOperation(db: CertForgeDatabase, id: string, position: number, answers: string[]): Promise<void> {
  const simulation = await assertInProgress(db, id);
  const question = await db.getRepository(SimulationQuestionEntity).findOneBy({ simulation_id: id, position });
  if (!question) throw new Error("Question not found");
  if (question.is_locked) throw new Error("This answer is locked");
  const snapshot = question.snapshot_json;
  const valid = new Set(snapshot.answers.map((answer) => answer.id));
  if (answers.some((answer) => !valid.has(answer))) throw new Error("An answer option is invalid");
  if (snapshot.type === "single-choice" && answers.length > 1) throw new Error("Select only one answer");
  const unique = [...new Set(answers)];
  if (snapshot.type === "multiple-choice" && unique.length > snapshot.correctAnswers.length) throw new Error(`Select at most ${snapshot.correctAnswers.length} answers`);
  const now = new Date().toISOString();
  await db.transaction(async (manager) => {
    const saved = manager.getRepository(SimulationAnswerEntity);
    await saved.delete({ simulation_id: id, position });
    for (const answer of unique) await saved.insert({ simulation_id: id, position, option_id: answer, selected_at: now });
    if (simulation.current_position !== position) await manager.getRepository(SimulationEntity).update({ id }, { current_position: position });
  });
}

async function setCurrentPositionOperation(db: CertForgeDatabase, id: string, position: number): Promise<void> {
  await assertInProgress(db, id);
  if (!await db.getRepository(SimulationQuestionEntity).existsBy({ simulation_id: id, position })) throw new Error("Question not found");
  await db.getRepository(SimulationEntity).update({ id }, { current_position: position });
}

async function setReviewFlagOperation(db: CertForgeDatabase, id: string, position: number, value: boolean): Promise<void> {
  const simulation = await assertInProgress(db, id);
  if (simulation.mode !== "exam") throw new Error("Review flags are only available in exam mode");
  const result = await db.getRepository(SimulationQuestionEntity).update({ simulation_id: id, position }, { for_review: value });
  if (!result.affected) throw new Error("Question not found");
}

async function confirmTrainingAnswerOperation(db: CertForgeDatabase, id: string, position: number): Promise<EvaluationResult> {
  const simulation = await assertInProgress(db, id);
  if (simulation.mode !== "training") throw new Error("Answers are confirmed only in training mode");
  const question = await db.getRepository(SimulationQuestionEntity).findOneBy({ simulation_id: id, position });
  if (!question) throw new Error("Question not found");
  if (question.is_locked) throw new Error("This answer is already locked");
  const answers = await db.getRepository(SimulationAnswerEntity).findBy({ simulation_id: id, position });
  if (!answers.length) throw new Error("Select at least one answer before confirming");
  const snapshot = question.snapshot_json;
  if (answers.length > snapshot.correctAnswers.length) throw new Error(`Select at most ${snapshot.correctAnswers.length} answers`);
  const evaluation = evaluateAnswer(answers.map((answer) => answer.option_id), snapshot.correctAnswers, snapshot.type);
  await db.getRepository(SimulationQuestionEntity).update({ simulation_id: id, position }, { is_locked: true, is_correct: evaluation.status === "correct", score_contribution: evaluation.score });
  return evaluation;
}

async function submitSimulationOperation(db: CertForgeDatabase, id: string): Promise<void> {
  const simulation = await db.getRepository(SimulationEntity).findOneBy({ id });
  if (!simulation) throw new Error("Simulation not found");
  if (simulation.status === "completed") return;
  await db.transaction(async (manager) => {
    const questions = await manager.getRepository(SimulationQuestionEntity).findBy({ simulation_id: id });
    let earnedCredit = 0;
    for (const row of questions) {
      const snapshot = row.snapshot_json;
      const answers = await manager.getRepository(SimulationAnswerEntity).findBy({ simulation_id: id, position: row.position });
      const evaluation = row.score_contribution === null
        ? evaluateAnswer(answers.map((answer) => answer.option_id), snapshot.correctAnswers, snapshot.type)
        : evaluationFromScore(row.score_contribution);
      earnedCredit += evaluation.score;
      await manager.getRepository(SimulationQuestionEntity).update({ simulation_id: id, position: row.position }, { is_locked: true, is_correct: evaluation.status === "correct", score_contribution: evaluation.score });
    }
    const score = questions.length ? (earnedCredit / questions.length) * 100 : 0;
    await manager.getRepository(SimulationEntity).update({ id }, { status: "completed", completed_at: new Date().toISOString(), score_percent: score });
  });
}

async function getCatalogOperation(db: CertForgeDatabase) {
  const banks = await db.getRepository(QuestionBankEntity).createQueryBuilder("b")
    .leftJoin("Question", "q", "q.bank_id = b.id AND q.bank_version = b.current_version")
    .select("b.id", "id").addSelect("b.title", "title").addSelect("b.certification_name", "certificationName")
    .addSelect("b.certification_code", "certificationCode").addSelect("b.current_version", "version")
    .addSelect("COUNT(q.question_id)", "questionCount").groupBy("b.id").orderBy("b.certification_code").addOrderBy("b.title")
    .getRawMany<{ id: string; title: string; certificationName: string; certificationCode: string; version: number; questionCount: number }>();
  const base = db.getRepository(QuestionEntity).createQueryBuilder("q")
    .innerJoin("QuestionBank", "b", "b.id = q.bank_id AND b.current_version = q.bank_version");
  const facets = await base.clone().select("b.certification_name", "certificationName").addSelect("b.certification_code", "certificationCode")
    .addSelect("q.domain", "domain").addSelect("q.topic", "topic").distinct(true)
    .orderBy("b.certification_code").addOrderBy("q.domain").addOrderBy("q.topic")
    .getRawMany<{ certificationName: string; certificationCode: string; domain: string; topic: string }>();
  const inventory = await base.clone().select("q.bank_id", "bankId").addSelect("b.certification_code", "certificationCode").addSelect("q.domain", "domain").addSelect("q.topic", "topic")
    .getRawMany<{ bankId: string; certificationCode: string; domain: string; topic: string }>();
  return { banks, facets, inventory };
}

// Public entry points queue once. Internal calls use operation functions to avoid nested locks.
export function createSimulation(db: CertForgeDatabase, input: unknown, random: () => number = Math.random) { return withDatabase(db, () => createSimulationOperation(db, input, random)); }
export function retrySimulation(db: CertForgeDatabase, id: string, random: () => number = Math.random) { return withDatabase(db, () => retrySimulationOperation(db, id, random)); }
export function getSimulation(db: CertForgeDatabase, id: string) { return withDatabase(db, () => getSimulationOperation(db, id)); }
export function saveAnswers(db: CertForgeDatabase, id: string, position: number, answers: string[]) { return withDatabase(db, () => saveAnswersOperation(db, id, position, answers)); }
export function setCurrentPosition(db: CertForgeDatabase, id: string, position: number) { return withDatabase(db, () => setCurrentPositionOperation(db, id, position)); }
export function setReviewFlag(db: CertForgeDatabase, id: string, position: number, value: boolean) { return withDatabase(db, () => setReviewFlagOperation(db, id, position, value)); }
export function confirmTrainingAnswer(db: CertForgeDatabase, id: string, position: number) { return withDatabase(db, () => confirmTrainingAnswerOperation(db, id, position)); }
export function submitSimulation(db: CertForgeDatabase, id: string) { return withDatabase(db, () => submitSimulationOperation(db, id)); }
export function getCatalog(db: CertForgeDatabase) { return withDatabase(db, () => getCatalogOperation(db)); }
