export const QUESTION_REPEAT_THRESHOLD = 3;

export interface SelectableQuestion {
  bankId: string;
  bankVersion: number;
  questionId: string;
  domain: string;
  topic?: string;
  exposureCount?: number;
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function logicalQuestionKey(question: Pick<SelectableQuestion, "bankId" | "questionId">): string {
  return JSON.stringify([question.bankId, question.questionId]);
}
const topicKey = (question: SelectableQuestion) => JSON.stringify([question.domain, question.topic ?? ""]);
const exposure = (question: SelectableQuestion) => question.exposureCount ?? 0;

// Shuffling before the stable sort randomizes every exposure tie.
function leastExposed<T extends SelectableQuestion>(pool: readonly T[], random: () => number): T[] {
  return shuffled(pool, random).sort((a, b) => exposure(a) - exposure(b));
}

export function replaceRepeatedQuestions<T extends SelectableQuestion>(selected: readonly T[], pool: readonly T[], random: () => number = Math.random): T[] {
  const used = new Set(selected.map(logicalQuestionKey));
  const alternatives = new Map<string, T[]>();
  for (const question of leastExposed(pool.filter((q) => !used.has(logicalQuestionKey(q))), random)) {
    const key = topicKey(question);
    const group = alternatives.get(key) ?? [];
    group.push(question);
    alternatives.set(key, group);
  }
  return selected.map((question) => {
    if (exposure(question) < QUESTION_REPEAT_THRESHOLD) return question;
    const candidates = alternatives.get(topicKey(question));
    const replacement = candidates?.[0];
    if (!replacement || exposure(replacement) >= exposure(question)) return question;
    candidates!.shift();
    // The displaced question is now unused and may improve a later slot.
    alternatives.set(topicKey(question), leastExposed([...candidates!, question], random));
    return replacement;
  });
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
  const composition: T[] = [];
  while (composition.length < count) {
    for (const queue of queues) {
      const question = queue.shift();
      if (question) composition.push(question);
      if (composition.length === count) break;
    }
  }

  // Preserve the original random domain/topic composition. Exposure only decides
  // which questions fill those slots, so a large unseen topic cannot take over.
  const topicQueues = new Map<string, T[]>();
  for (const question of leastExposed(pool, random)) {
    const key = topicKey(question);
    const group = topicQueues.get(key) ?? [];
    group.push(question);
    topicQueues.set(key, group);
  }
  const selected = composition.map((slot) => topicQueues.get(topicKey(slot))!.shift()!);
  return shuffled(replaceRepeatedQuestions(selected, pool, random), random);
}
