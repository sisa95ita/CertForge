export interface SelectableQuestion {
  bankId: string;
  bankVersion: number;
  questionId: string;
  domain: string;
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function selectQuestions<T extends SelectableQuestion>(pool: readonly T[], count: number, random: () => number = Math.random): T[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("Question count must be a positive integer");
  if (count > pool.length) throw new Error(`Only ${pool.length} questions are available for the selected filters`);

  const groups = new Map<string, T[]>();
  for (const question of shuffled(pool, random)) {
    const key = question.domain || "Unspecified";
    const group = groups.get(key) ?? [];
    group.push(question);
    groups.set(key, group);
  }
  const queues = shuffled([...groups.values()], random);
  const selected: T[] = [];
  while (selected.length < count) {
    let added = false;
    for (const queue of queues) {
      const question = queue.shift();
      if (question) {
        selected.push(question);
        added = true;
        if (selected.length === count) break;
      }
    }
    if (!added) break;
  }
  return shuffled(selected, random);
}
