export function normalizeAnswers(answers: readonly string[]): string[] {
  return [...new Set(answers)].sort();
}

export function isCorrectAnswer(selected: readonly string[], correct: readonly string[]): boolean {
  const left = normalizeAnswers(selected);
  const right = normalizeAnswers(correct);
  return left.length === right.length && left.every((answer, index) => answer === right[index]);
}
