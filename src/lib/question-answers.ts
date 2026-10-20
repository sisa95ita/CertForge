import type { SimulationQuestionView, SnapshotQuestion, YesNo } from "./types";

// JSON tuples avoid collisions even when imported statement IDs contain punctuation.
export function matrixAnswerId(statementId: string, answer: YesNo): string {
  return JSON.stringify([statementId, answer]);
}
export function matrixSelection(selected: readonly string[], statementId: string): YesNo | null {
  if (selected.includes(matrixAnswerId(statementId, "yes"))) return "yes";
  if (selected.includes(matrixAnswerId(statementId, "no"))) return "no";
  return null;
}
export function withMatrixAnswer(selected: readonly string[], statementId: string, answer: YesNo): string[] {
  return [...selected.filter((id) => id !== matrixAnswerId(statementId, "yes") && id !== matrixAnswerId(statementId, "no")), matrixAnswerId(statementId, answer)];
}
export function validAnswerIds(question: SnapshotQuestion): string[] {
  return question.type === "yes-no-matrix"
    ? (question.statements ?? []).flatMap((statement) => [matrixAnswerId(statement.id, "yes"), matrixAnswerId(statement.id, "no")])
    : question.answers.map((option) => option.id);
}
export function correctAnswerIds(question: SnapshotQuestion): string[] {
  return question.type === "yes-no-matrix"
    ? (question.statements ?? []).map((statement) => matrixAnswerId(statement.id, statement.correctAnswer))
    : question.correctAnswers;
}
export function isFullyAnswered(item: Pick<SimulationQuestionView, "question" | "selectedAnswers">): boolean {
  return item.question.type === "yes-no-matrix"
    ? (item.question.statements ?? []).length === 3 && item.question.statements!.every((statement) => matrixSelection(item.selectedAnswers, statement.id) !== null)
    : item.selectedAnswers.length > 0;
}
