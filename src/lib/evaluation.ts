export function normalizeAnswers(answers: readonly string[]): string[] {
  return [...new Set(answers)].sort();
}

export function isCorrectAnswer(selected: readonly string[], correct: readonly string[]): boolean {
  const left = normalizeAnswers(selected);
  const right = normalizeAnswers(correct);
  return left.length === right.length && left.every((answer, index) => answer === right[index]);
}

export function evaluationFromScore(score: number): import("./types").EvaluationResult {
  const credit = Math.max(0, Math.min(1, score));
  return { status: credit === 1 ? "correct" : credit > 0 ? "partial" : "incorrect", score: credit };
}

export function evaluateAnswer(selected: readonly string[], correct: readonly string[], type: import("./types").QuestionType): import("./types").EvaluationResult {
  const unique = normalizeAnswers(selected);
  if (type === "single-choice") return evaluationFromScore(isCorrectAnswer(unique, correct) ? 1 : 0);
  // Older active sessions may contain selections above the new limit.
  if (!correct.length || unique.length > correct.length) return evaluationFromScore(0);
  const required = new Set(correct);
  return evaluationFromScore(unique.filter((answer) => required.has(answer)).length / required.size);
}

export function canSelectAnswer(selected: readonly string[], optionId: string, requiredCount: number): boolean {
  return selected.includes(optionId) || new Set(selected).size < requiredCount;
}
