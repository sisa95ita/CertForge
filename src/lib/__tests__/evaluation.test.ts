import { describe, expect, it } from "vitest";
import { canSelectAnswer, evaluateAnswer, evaluationFromScore, isCorrectAnswer } from "../evaluation";
describe("answer evaluation", () => {
  it("keeps order-independent exact-set correctness", () => {
    expect(isCorrectAnswer(["c", "a"], ["a", "c"])).toBe(true);
    expect(isCorrectAnswer(["a"], ["a", "c"])).toBe(false);
    expect(isCorrectAnswer(["a", "b", "c"], ["a", "c"])).toBe(false);
  });
  it.each([
    [["b"], "correct", 1], [["a"], "incorrect", 0], [[], "incorrect", 0], [["a", "b"], "incorrect", 0],
  ] as const)("scores single-choice %j as %s", (selected, status, score) => {
    expect(evaluateAnswer(selected, ["b"], "single-choice")).toEqual({ status, score });
  });
  it.each([
    [["d", "c", "a"], "correct", 1], [["a", "c", "e"], "partial", 2/3], [["a", "e", "f"], "partial", 1/3],
    [["e", "f"], "incorrect", 0], [[], "incorrect", 0], [["a"], "partial", 1/3],
    [["a", "a", "c"], "partial", 2/3], [["a", "c", "d", "e"], "incorrect", 0],
  ] as const)("scores multiple-choice %j as %s", (selected, status, score) => {
    expect(evaluateAnswer(selected, ["a", "c", "d"], "multiple-choice")).toEqual({ status, score });
  });
  it("clamps credit", () => {
    expect(evaluationFromScore(2)).toEqual({ status: "correct", score: 1 });
    expect(evaluationFromScore(-1)).toEqual({ status: "incorrect", score: 0 });
  });
  it("blocks new options at the limit but permits deselection", () => {
    expect(canSelectAnswer(["a"], "b", 2)).toBe(true);
    expect(canSelectAnswer(["a", "b"], "c", 2)).toBe(false);
    expect(canSelectAnswer(["a", "b"], "a", 2)).toBe(true);
  });
});
