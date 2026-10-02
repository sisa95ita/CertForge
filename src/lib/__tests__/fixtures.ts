import type { QuestionBankInput } from "../question-bank-schema";
export function testBank(version = 1, suffix = ""): QuestionBankInput {
  return {
    id: "98f03ec4-7b58-45db-a1ac-f30d072433c4", schemaVersion: 1, version, title: "Bank" + suffix, description: "Tests",
    certification: { name: "Generic certification", code: "TEST" },
    questions: Array.from({ length: 4 }, (_, i) => ({
      id: `q${i+1}`, domain: i < 2 ? "D1" : "D2", topic: i < 2 ? "T1" : "T2", difficulty: "medium",
      type: i === 1 ? "multiple-choice" : "single-choice", question: `Question ${i+1}${suffix}`,
      answers: ["a", "b", "c", "d"].map((id) => ({ id, text: id + suffix })),
      correctAnswers: i === 1 ? ["a", "c"] : ["a"], explanation: "Explanation" + suffix,
      learnReference: { title: "Learn" + suffix, url: "https://learn.microsoft.com/en-us/training/" },
    })),
  };
}
