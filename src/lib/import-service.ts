import { withDatabase, type CertForgeDatabase } from "./db";
import { QuestionBankEntity, QuestionBankVersionEntity, QuestionEntity, QuestionOptionEntity } from "./persistence/entities";
import { formatValidationErrors, questionBankSchema } from "./question-bank-schema";

export type ImportResult =
  | { status: "imported"; title: string; questions: number; version: number }
  | { status: "updated"; title: string; questions: number; version: number; previousVersion: number }
  | { status: "skipped"; title: string; reason: "same-version" | "newer-installed"; version: number }
  | { status: "failed"; title: string; errors: string[] };


export async function importQuestionBank(db: CertForgeDatabase, input: unknown): Promise<ImportResult> {
  const parsed = questionBankSchema.safeParse(input);
  if (!parsed.success) {
    const title = typeof input === "object" && input !== null && "title" in input && typeof input.title === "string" ? input.title : "Invalid question bank";
    return { status: "failed", title, errors: formatValidationErrors(parsed.error) };
  }
  const bank = parsed.data;
  return withDatabase(db, async () => {
    const existing = await db.getRepository(QuestionBankEntity).findOneBy({ id: bank.id });
    if (existing && bank.version === existing.current_version) return { status: "skipped", title: bank.title, reason: "same-version", version: bank.version };
    if (existing && bank.version < existing.current_version) return { status: "skipped", title: bank.title, reason: "newer-installed", version: bank.version };
    const previousVersion = existing?.current_version;
    const now = new Date().toISOString();
    const metadata = { title: bank.title, description: bank.description, certification_name: bank.certification.name, certification_code: bank.certification.code };
    try {
      await db.transaction(async (manager) => {
        const banks = manager.getRepository(QuestionBankEntity);
        if (existing) await banks.update({ id: bank.id }, { ...metadata, current_version: bank.version, updated_at: now });
        else await banks.insert({ ...metadata, id: bank.id, current_version: bank.version, created_at: now, updated_at: now });
        await manager.getRepository(QuestionBankVersionEntity).insert({ ...metadata, bank_id: bank.id, version: bank.version, schema_version: bank.schemaVersion, imported_at: now });
        for (const question of bank.questions) {
          const key = { bank_id: bank.id, bank_version: bank.version, question_id: question.id };
          await manager.getRepository(QuestionEntity).insert({
            ...key, domain: question.domain, topic: question.topic, difficulty: question.difficulty, type: question.type,
            text: question.question, explanation: question.explanation,
            reference_title: question.learnReference?.title ?? null, reference_url: question.learnReference?.url ?? null,
            correct_answers_json: question.correctAnswers,
          });
          for (const [index, answer] of question.answers.entries()) {
            await manager.getRepository(QuestionOptionEntity).insert({ ...key, option_id: answer.id, text: answer.text, display_order: index });
          }
        }
      });
    } catch {
      return { status: "failed", title: bank.title, errors: ["Database import failed"] };
    }
    return previousVersion === undefined
      ? { status: "imported", title: bank.title, questions: bank.questions.length, version: bank.version }
      : { status: "updated", title: bank.title, questions: bank.questions.length, version: bank.version, previousVersion };
  });
}
