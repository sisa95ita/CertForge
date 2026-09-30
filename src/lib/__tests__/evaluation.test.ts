import { describe, expect, it } from "vitest";
import { isCorrectAnswer } from "../evaluation";

describe("answer evaluation", () => {
  it("scores a single-choice answer", () => { expect(isCorrectAnswer(["b"], ["b"])).toBe(true); expect(isCorrectAnswer(["a"], ["b"])).toBe(false); });
  it("scores multiple-choice as an exact, order-independent set", () => { expect(isCorrectAnswer(["c", "a"], ["a", "c"])).toBe(true); expect(isCorrectAnswer(["a"], ["a", "c"])).toBe(false); expect(isCorrectAnswer(["a", "b", "c"], ["a", "c"])).toBe(false); });
});
