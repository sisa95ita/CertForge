import { describe, expect, it, vi } from "vitest";
import { logicalQuestionKey, QUESTION_REPEAT_THRESHOLD, replaceRepeatedQuestions, selectQuestions, type SelectableQuestion } from "../selection";

const question = (questionId: string, exposureCount: number, domain = "D", topic = "T"): SelectableQuestion => ({ bankId: "b", bankVersion: 1, questionId, exposureCount, domain, topic });
const questions = (prefix: string, count: number, exposureCount: number, domain = "D", topic = "T") =>
  Array.from({ length: count }, (_, index) => question(`${prefix}${index}`, exposureCount, domain, topic));
const identity = () => 0.999;

describe("exposure-aware selection", () => {
  it.each([[0, 1], [1, 2], [2, 3], [3, 4], [4, 7]])("prefers exposure %s over %s within a topic", (lower, higher) => {
    expect(selectQuestions([question("high", higher), question("low", lower)], 1, identity)[0].questionId).toBe("low");
  });
  it.each([0, 0.4, 0.999])("selects only unseen questions when enough exist (random = %s)", (value) => {
    const pool = [
      ...questions("seen", 50, 1, "D1", "A"),
      ...questions("unseenA", 5, 0, "D1", "A"),
      ...questions("unseenB", 95, 0, "D2", "B"),
      ...questions("twice", 25, 2, "D1", "A"),
    ];
    const selected = selectQuestions(pool, 50, () => value);
    expect(selected).toHaveLength(50);
    expect(selected.every((q) => q.exposureCount === 0)).toBe(true);
  });
  it.each([[0, 1, 20, 50, 30], [1, 2, 5, 20, 10], [2, 3, 5, 20, 10], [3, 4, 5, 20, 10]])(
    "exhausts exposure %s before %s across topics",
    (lower, higher, lowerCount, higherCount, count) => {
      const pool = [...questions("high", higherCount, higher, "D1", "A"), ...questions("low", lowerCount, lower, "D2", "B")];
      const selected = selectQuestions(pool, count, identity);
      expect(selected).toHaveLength(count);
      expect(selected.filter((q) => q.exposureCount === lower)).toHaveLength(lowerCount);
      expect(selected.filter((q) => q.exposureCount === higher)).toHaveLength(count - lowerCount);
    },
  );
  it("never skips unseen questions to balance topics", () => {
    const pool = [...questions("seenA", 20, 1, "D", "A"), ...questions("unseenA", 2, 0, "D", "A"), ...questions("unseenB", 30, 0, "D", "B")];
    const selected = selectQuestions(pool, 10, identity);
    expect(selected).toHaveLength(10);
    expect(selected.every((q) => q.exposureCount === 0)).toBe(true);
    expect(selected.filter((q) => q.topic === "A")).toHaveLength(2);
  });
  it("treats missing exposure counts as unseen", () => {
    const unseen = { bankId: "b", bankVersion: 1, questionId: "unseen", domain: "D2" };
    expect(selectQuestions([question("seen", 1), unseen], 1, identity)).toEqual([unseen]);
  });
  it("randomizes which equivalent questions are selected using injected randomness", () => {
    const pool = questions("q", 20, 1);
    const random = vi.fn(() => 0);
    const selected = selectQuestions(pool, 5, random);
    expect(random).toHaveBeenCalled();
    expect(new Set(selected.map(logicalQuestionKey))).not.toEqual(new Set(selectQuestions(pool, 5, identity).map(logicalQuestionKey)));
    expect(selectQuestions(pool, 5, () => 0)).toEqual(selected);
  });
  it("balances domains and topics within a single exposure bucket despite unequal topic sizes", () => {
    const pool = ["D1", "D2", "D3"].flatMap((domain) => [
      ...questions(`${domain}large`, 40, 0, domain, "Large"),
      ...questions(`${domain}small`, 2, 0, domain, "Small"),
    ]);
    const selected = selectQuestions(pool, 12, identity);
    expect(selected).toHaveLength(12);
    for (const domain of ["D1", "D2", "D3"]) {
      expect(selected.filter((q) => q.domain === domain)).toHaveLength(4);
      for (const topic of ["Large", "Small"]) {
        expect(selected.filter((q) => q.domain === domain && q.topic === topic)).toHaveLength(2);
      }
    }
  });
  it("continues balancing available unseen topics when a small topic is exhausted", () => {
    const pool = [
      ...questions("a", 2, 0, "D", "A"),
      ...questions("b", 18, 0, "D", "B"),
      ...questions("c", 50, 0, "D", "C"),
      ...questions("seenA", 30, 1, "D", "A"),
    ];
    const selected = selectQuestions(pool, 20, identity);
    expect(selected.every((q) => q.exposureCount === 0)).toBe(true);
    expect(["A", "B", "C"].map((topic) => selected.filter((q) => q.topic === topic).length)).toEqual([2, 9, 9]);
  });
  it("never selects a logical question twice even across bank versions", () => {
    const original = question("shared", 0);
    const pool = [original, { ...original, bankVersion: 2 }, { ...original, bankVersion: 3 }, { ...original, bankId: "another-bank" }, question("other", 0)];
    const selected = selectQuestions(pool, 3, identity);
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map(logicalQuestionKey))).toHaveLength(3);
    expect(selected.filter((q) => q.questionId === "shared")).toHaveLength(2);
    expect(() => selectQuestions(pool, 4, identity)).toThrow(/Only 3 questions/);
  });
  it("replaces repeated candidates only with unused lower-exposure questions in the same topic/domain", () => {
    const original = question("old", 4);
    const pool = [original, question("otherTopic", 0, "D", "Elsewhere"), question("otherDomain", 0, "Elsewhere"), question("one", 1), question("zero", 0)];
    expect(replaceRepeatedQuestions([original], pool, identity).map((q) => q.questionId)).toEqual(["zero"]);
  });
  it("randomizes equal replacements, prefers below threshold and never duplicates selected questions", () => {
    const first = question("first", 5), second = question("second", 5);
    const pool = [first, second, question("used", 0), question("a", 1), question("b", 1), question("three", 3)];
    const result = replaceRepeatedQuestions([first, second, pool[2]], pool, identity);
    expect(result.map((q) => q.questionId)).toEqual(["a", "b", "used"]);
    expect(replaceRepeatedQuestions([first], [first, question("a", 1), question("b", 1)], () => 0)[0].questionId).not.toBe("a");
  });
  it("keeps unavoidable repeated candidates and can fall back to a lower count above threshold", () => {
    const original = question("old", 5);
    expect(replaceRepeatedQuestions([original], [original, question("other", 0, "D", "Elsewhere")], identity)).toEqual([original]);
    expect(replaceRepeatedQuestions([original], [original, question("lower", 3)], identity)[0].questionId).toBe("lower");
    expect(QUESTION_REPEAT_THRESHOLD).toBe(3);
  });
  it("allows a displaced question to improve a later repeated slot", () => {
    const selected = [question("three", 3), question("five", 5)];
    expect(replaceRepeatedQuestions(selected, [...selected, question("zero", 0)], identity).map((q) => q.questionId)).toEqual(["zero", "three"]);
  });
  it("all available includes the entire pool regardless of exposure", () => {
    const pool = [question("a", 0), question("b", 3), question("c", 4)];
    expect(new Set(selectQuestions(pool, 3, identity).map((q) => q.questionId))).toEqual(new Set(["a", "b", "c"]));
  });
});