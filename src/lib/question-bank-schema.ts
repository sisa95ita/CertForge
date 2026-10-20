import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const optionSchema = z.object({
  id: z.string().trim().min(1, "Option id is required"), text: z.string().trim().min(1, "Option text is required"),
});
const common = {
  id: nonEmpty, domain: nonEmpty, topic: nonEmpty, difficulty: nonEmpty,
  question: nonEmpty,
  explanation: nonEmpty,
  learnReference: z.object({
    title: nonEmpty,
    url: z.url().refine((url) => {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "learn.microsoft.com";
    }, { message: "Reference URL must be an HTTPS learn.microsoft.com URL" }),
  }).optional(),
};
const choiceShape = {
  ...common,
  answers: z.array(optionSchema).min(2),
  correctAnswers: z.array(nonEmpty).min(1),
};
function validateOptions(question: { type: string; answers: { id: string }[]; correctAnswers: string[] }, ctx: z.RefinementCtx) {
  const ids = new Set(question.answers.map((answer) => answer.id));
  if (ids.size !== question.answers.length) ctx.addIssue({ code: "custom", path: ["answers"], message: "Answer option ids must be unique" });
  for (const answer of question.correctAnswers) {
    if (!ids.has(answer)) ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: `Correct answer '${answer}' does not reference an option` });
  }
  if (new Set(question.correctAnswers).size !== question.correctAnswers.length) ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "Correct answers must be unique" });
  if (question.type === "single-choice" && question.correctAnswers.length !== 1) ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "A single-choice question must have exactly one correct answer" });
  if (question.type === "multiple-choice" && question.correctAnswers.length < 2) ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "A multiple-choice question must have at least two correct answers" });
  if (question.type === "statement-completion" && question.correctAnswers.length !== 1) ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "A completion question must have exactly one correct answer" });
}
// V1 deliberately retains its original validation, including free-form difficulty.
const v1Question = z.object({ ...choiceShape, type: z.enum(["single-choice", "multiple-choice"]) }).superRefine(validateOptions);
const difficulty = z.enum(["easy", "medium", "hard"]);
const v2Choice = z.object({ ...choiceShape, difficulty, type: z.enum(["single-choice", "multiple-choice"]) }).superRefine(validateOptions);
const completion = z.object({ ...choiceShape, difficulty, type: z.literal("statement-completion") }).superRefine((question, ctx) => {
  validateOptions(question, ctx);
  if (question.question.split("{{blank}}").length !== 2) ctx.addIssue({ code: "custom", path: ["question"], message: "A completion question must contain exactly one {{blank}} token" });
});
const matrix = z.object({
  ...common, difficulty, type: z.literal("yes-no-matrix"),
  // An overall explanation is optional; every individual statement requires one.
  explanation: nonEmpty.optional().default(""),
  statements: z.array(z.object({ id: nonEmpty, text: nonEmpty, correctAnswer: z.enum(["yes", "no"]), explanation: nonEmpty })).length(3, "A matrix question must have exactly three statements"),
}).superRefine((question, ctx) => {
  if (new Set(question.statements.map((statement) => statement.id)).size !== question.statements.length) ctx.addIssue({ code: "custom", path: ["statements"], message: "Statement ids must be unique" });
});
const bankShape = {
  id: z.uuid(), version: z.number().int().positive(), title: nonEmpty, description: nonEmpty,
  certification: z.object({ name: nonEmpty, code: nonEmpty }),
};
export const questionBankV1Schema = z.object({ ...bankShape, schemaVersion: z.literal(1), questions: z.array(v1Question).min(1, "Question bank cannot be empty") });
const questionBankV2Schema = z.object({ ...bankShape, schemaVersion: z.literal(2), questions: z.array(z.union([v2Choice, completion, matrix])).min(1, "Question bank cannot be empty") });
export const questionBankSchema = z.discriminatedUnion("schemaVersion", [questionBankV1Schema, questionBankV2Schema]).superRefine((bank, ctx) => {
  const seen = new Set<string>();
  bank.questions.forEach((question, index) => {
    if (seen.has(question.id)) ctx.addIssue({ code: "custom", path: ["questions", index, "id"], message: `Duplicate question id '${question.id}'` });
    seen.add(question.id);
  });
});
export type QuestionBankV1Input = z.infer<typeof questionBankV1Schema>;
export type QuestionBankInput = z.infer<typeof questionBankSchema>;
export type QuestionInput = QuestionBankInput["questions"][number];
export function formatValidationErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "document"}: ${issue.message}`);
}
