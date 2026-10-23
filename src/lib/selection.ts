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
  const unique = new Map<string, T>();
  for (const question of pool) {
    const key = logicalQuestionKey(question);
    if (!unique.has(key)) unique.set(key, question);
  }
  const eligible = [...unique.values()];
  if (count > eligible.length) throw new Error(`Only ${eligible.length} questions are available for the selected filters`);

  const buckets = new Map<number, T[]>();
  for (const question of eligible) {
    const level = exposure(question);
    const bucket = buckets.get(level) ?? [];
    bucket.push(question);
    buckets.set(level, bucket);
  }

  const selected: T[] = [];
  // Exact exposure levels take priority, including distinct counts above the threshold.
  for (const [, bucket] of [...buckets.entries()].sort(([a], [b]) => a - b)) {
    const domains = new Map<string, Map<string, T[]>>();
    for (const question of shuffled(bucket, random)) {
      const domain = question.domain || "Unspecified";
      const topics = domains.get(domain) ?? new Map<string, T[]>();
      const key = topicKey(question);
      const topic = topics.get(key) ?? [];
      topic.push(question);
      topics.set(key, topic);
      domains.set(domain, topics);
    }
    const queues = shuffled([...domains.values()], random).map((topics) => shuffled([...topics.values()], random));
    const target = Math.min(count, selected.length + bucket.length);
    // Round-robin domains, then topics within each domain, only at this exposure level.
    while (selected.length < target) {
      for (const topics of queues) {
        const topic = topics.shift();
        if (!topic) continue;
        selected.push(topic.shift()!);
        if (topic.length) topics.push(topic);
        if (selected.length === target) break;
      }
    }
    if (selected.length === count) break;
  }
  return shuffled(replaceRepeatedQuestions(selected, eligible, random), random);
}
