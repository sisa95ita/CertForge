import { describe, expect, it } from "vitest";
import { questionBankSchema } from "../question-bank-schema";

const validBank = {
  id: "c45306e8-e829-4c25-92f2-956454b548c1", schemaVersion: 1, version: 1, title: "Test bank", description: "For tests",
  certification: { name: "Test Certification", code: "TEST-1" },
  questions: [{ id: "q1", domain: "Domain", topic: "Topic", difficulty: "easy", type: "single-choice", question: "Pick one", answers: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"], explanation: "A is right", learnReference: { title: "Learn", url: "https://learn.microsoft.com/en-us/test" } }],
} as const;

describe("questionBankSchema", () => {
  it("accepts a valid bank", () => expect(questionBankSchema.safeParse(validBank).success).toBe(true));
  it("rejects invalid ids, duplicate questions, and nonexistent correct options", () => {
    const invalid = { ...validBank, id: "not-a-uuid", questions: [{ ...validBank.questions[0], correctAnswers: ["missing"] }, { ...validBank.questions[0] }] };
    const result = questionBankSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(/UUID|reference|Duplicate/i);
  });
});
