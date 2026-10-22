import { describe, expect, it } from "vitest";
import { QUESTION_REPEAT_THRESHOLD, replaceRepeatedQuestions, selectQuestions, type SelectableQuestion } from "../selection";

const question = (questionId: string, exposureCount: number, domain = "D", topic = "T"): SelectableQuestion => ({ bankId: "b", bankVersion: 1, questionId, exposureCount, domain, topic });
const identity = () => 0.999;
describe("exposure-aware selection", () => {
  it.each([[0, 1], [1, 2], [2, 3]])("prefers exposure %s over %s within a topic", (lower, higher) => {
    expect(selectQuestions([question("high", higher), question("low", lower)], 1, identity)[0].questionId).toBe("low");
  });
  it("randomizes ties with injected randomness", () => {
    const pool = ["a", "b", "c", "d"].map((id) => question(id, 1));
    expect(selectQuestions(pool, 2, identity).map((q) => q.questionId)).not.toEqual(selectQuestions(pool, 2, () => 0).map((q) => q.questionId));
  });
  it("preserves original domain and topic composition even if one topic has many unseen questions", () => {
    const pool = [question("a", 3, "D1", "T1"), question("b", 0, "D1", "T2"), question("c", 3, "D2", "T3"), question("d", 0, "D2", "T4")];
    const selected = selectQuestions(pool, 2, identity);
    expect(selected.map((q) => [q.domain, q.topic])).toEqual([["D1", "T1"], ["D2", "T3"]]);
    expect(selected.every((q) => q.exposureCount === QUESTION_REPEAT_THRESHOLD)).toBe(true);
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
