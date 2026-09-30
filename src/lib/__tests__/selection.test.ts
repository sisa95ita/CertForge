import { describe, expect, it } from "vitest";
import { selectQuestions } from "../selection";

describe("question selection", () => {
  const pool = [
    ...Array.from({ length: 8 }, (_, index) => ({ bankId: "b", bankVersion: 1, questionId: `a${index}`, domain: "A" })),
    ...Array.from({ length: 2 }, (_, index) => ({ bankId: "b", bankVersion: 1, questionId: `b${index}`, domain: "B" })),
  ];
  it("selects a fixed number without duplicates and distributes domains", () => {
    const selected = selectQuestions(pool, 4, () => 0.4);
    expect(selected).toHaveLength(4);
    expect(new Set(selected.map((item) => item.questionId))).toHaveLength(4);
    expect(new Set(selected.map((item) => item.domain))).toEqual(new Set(["A", "B"]));
  });
  it("rejects a count larger than the pool", () => expect(() => selectQuestions(pool, 11)).toThrow(/10 questions/));
});
