import { describe, expect, it } from "vitest";
import { answerLabel } from "../answer-label";

describe("answer display labels", () => {
  it.each([
    [0, "A"], [1, "B"], [2, "C"], [3, "D"], [4, "E"],
    [25, "Z"], [26, "AA"], [27, "AB"], [51, "AZ"],
    [52, "BA"], [701, "ZZ"], [702, "AAA"],
  ] as const)("labels display index %i as %s", (index, expected) => {
    expect(answerLabel(index)).toBe(expected);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid index %s", (index) => {
    expect(() => answerLabel(index)).toThrow(RangeError);
  });
});
