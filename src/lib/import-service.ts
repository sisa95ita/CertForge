import type { CertForgeDatabase } from "./db";
import { formatValidationErrors, questionBankSchema, type QuestionBankInput } from "./question-bank-schema";

export type ImportResult =
  | { status: "imported"; title: string; questions: number; version: number }
  | { status: "updated"; title: string; questions: number; version: number; previousVersion: number }
  | { status: "skipped"; title: string; reason: "same-version" | "newer-installed"; version: number }
  | { status: "failed"; title: string; errors: string[] };

interface BankRow { current_version: number; title: string }

export function importQuestionBank(db: CertForgeDatabase, input: unknown): ImportResult {
  const parsed = questionBankSchema.safeParse(input);
  if (!parsed.success) {
    const title = typeof input === "object" && input !== null && "title" in input && typeof input.title === "string" ? input.title : "Invalid question bank";
    return { status: "failed", title, errors: formatValidationErrors(parsed.error) };
  }
  const bank = parsed.data;
  const existing = db.prepare("SELECT current_version, title FROM question_banks WHERE id = ?").get(bank.id) as BankRow | undefined;
  if (existing && bank.version === existing.current_version) {
    return { status: "skipped", title: bank.title, reason: "same-version", version: bank.version };
  }
  if (existing && bank.version < existing.current_version) {
    return { status: "skipped", title: bank.title, reason: "newer-installed", version: bank.version };
  }

  const previousVersion = existing?.current_version;
  const now = new Date().toISOString();
  const write = db.transaction((value: QuestionBankInput) => {
    if (existing) {
      db.prepare(`UPDATE question_banks SET current_version = ?, title = ?, description = ?, certification_name = ?, certification_code = ?, updated_at = ? WHERE id = ?`)
        .run(value.version, value.title, value.description, value.certification.name, value.certification.code, now, value.id);
    } else {
      db.prepare(`INSERT INTO question_banks (id, current_version, title, description, certification_name, certification_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(value.id, value.version, value.title, value.description, value.certification.name, value.certification.code, now, now);
    }
    db.prepare(`INSERT INTO question_bank_versions (bank_id, version, schema_version, title, description, certification_name, certification_code, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(value.id, value.version, value.schemaVersion, value.title, value.description, value.certification.name, value.certification.code, now);

    const insertQuestion = db.prepare(`INSERT INTO questions (bank_id, bank_version, question_id, domain, topic, difficulty, type, text, explanation, reference_title, reference_url, correct_answers_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertOption = db.prepare(`INSERT INTO question_options (bank_id, bank_version, question_id, option_id, text, display_order) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const question of value.questions) {
      insertQuestion.run(value.id, value.version, question.id, question.domain, question.topic, question.difficulty, question.type, question.question, question.explanation, question.learnReference?.title ?? null, question.learnReference?.url ?? null, JSON.stringify(question.correctAnswers));
      question.answers.forEach((answer, index) => insertOption.run(value.id, value.version, question.id, answer.id, answer.text, index));
    }
  });

  try {
    write(bank);
  } catch (error) {
    return { status: "failed", title: bank.title, errors: [error instanceof Error ? error.message : "Database import failed"] };
  }
  return previousVersion === undefined
    ? { status: "imported", title: bank.title, questions: bank.questions.length, version: bank.version }
    : { status: "updated", title: bank.title, questions: bank.questions.length, version: bank.version, previousVersion };
}
