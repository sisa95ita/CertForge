import { testBank } from "./fixtures";

export function matrixQuestion(suffix = "") {
  return {
    id: "matrix", domain: "Matrix domain", topic: "Matrix topic", difficulty: "medium" as const,
    type: "yes-no-matrix" as const, question: "Evaluate these statements" + suffix,
    statements: [
      { id: 's1:yes["x"]', text: "Statement one" + suffix, correctAnswer: "yes" as const, explanation: "First explanation" + suffix },
      { id: "s2", text: "Statement two" + suffix, correctAnswer: "no" as const, explanation: "Second explanation" + suffix },
      { id: "s3", text: "Statement three" + suffix, correctAnswer: "yes" as const, explanation: "Third explanation" + suffix },
    ],
    explanation: "Overall explanation" + suffix,
    learnReference: { title: "Matrix Learn" + suffix, url: "https://learn.microsoft.com/en-us/training/" },
  };
}
export function completionQuestion(suffix = "") {
  return {
    id: "completion", domain: "Completion domain", topic: "Completion topic", difficulty: "hard" as const,
    type: "statement-completion" as const, question: "Call client.{{blank}}(...) to respond." + suffix,
    answers: [
      { id: "opaque-option-1", text: "responses.create" + suffix },
      { id: "opaque-option-2", text: "models.list" + suffix },
      { id: "opaque-option-3", text: "deployments.get" + suffix },
      { id: "opaque-option-4", text: "responses.delete" + suffix },
    ],
    correctAnswers: ["opaque-option-1"], explanation: "Completion explanation" + suffix,
    learnReference: { title: "Completion Learn" + suffix, url: "https://learn.microsoft.com/en-us/training/" },
  };
}
export function v2Bank(version = 1, suffix = "") {
  return {
    ...testBank(version, suffix), id: "c45306e8-e829-4c25-92f2-956454b548c1",
    schemaVersion: 2 as const, questions: [matrixQuestion(suffix), completionQuestion(suffix)],
  };
}
