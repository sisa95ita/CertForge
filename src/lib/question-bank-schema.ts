import { z } from "zod";

const optionSchema = z.object({
  id: z.string().trim().min(1, "Option id is required"),
  text: z.string().trim().min(1, "Option text is required"),
});

const questionSchema = z.object({
  id: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  difficulty: z.string().trim().min(1),
  type: z.enum(["single-choice", "multiple-choice"]),
  question: z.string().trim().min(1),
  answers: z.array(optionSchema).min(2),
  correctAnswers: z.array(z.string().trim().min(1)).min(1),
  explanation: z.string().trim().min(1),
  learnReference: z.object({
    title: z.string().trim().min(1),
    url: z.url().refine((url) => {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "learn.microsoft.com";
    }, {
      message: "Reference URL must be an HTTPS learn.microsoft.com URL",
    }),
  }).optional(),
}).superRefine((question, ctx) => {
  const optionIds = question.answers.map((answer) => answer.id);
  const uniqueOptions = new Set(optionIds);
  if (uniqueOptions.size !== optionIds.length) {
    ctx.addIssue({ code: "custom", path: ["answers"], message: "Answer option ids must be unique" });
  }
  for (const answer of question.correctAnswers) {
    if (!uniqueOptions.has(answer)) {
      ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: `Correct answer '${answer}' does not reference an option` });
    }
  }
  if (new Set(question.correctAnswers).size !== question.correctAnswers.length) {
    ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "Correct answers must be unique" });
  }
  if (question.type === "single-choice" && question.correctAnswers.length !== 1) {
    ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "A single-choice question must have exactly one correct answer" });
  }
  if (question.type === "multiple-choice" && question.correctAnswers.length < 2) {
    ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "A multiple-choice question must have at least two correct answers" });
  }
});

export const questionBankSchema = z.object({
  id: z.uuid(),
  schemaVersion: z.literal(1, { error: "Only schema version 1 is supported" }),
  version: z.number().int().positive(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  certification: z.object({
    name: z.string().trim().min(1),
    code: z.string().trim().min(1),
  }),
  questions: z.array(questionSchema).min(1, "Question bank cannot be empty"),
}).superRefine((bank, ctx) => {
  const seen = new Set<string>();
  bank.questions.forEach((question, index) => {
    if (seen.has(question.id)) {
      ctx.addIssue({ code: "custom", path: ["questions", index, "id"], message: `Duplicate question id '${question.id}'` });
    }
    seen.add(question.id);
  });
});

export type QuestionBankInput = z.infer<typeof questionBankSchema>;
export type QuestionInput = QuestionBankInput["questions"][number];

export function formatValidationErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "document"}: ${issue.message}`);
}
