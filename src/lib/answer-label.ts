/** Converts a zero-based display position to A, ..., Z, AA, AB, ... without using option IDs. */
export function answerLabel(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Answer display index must be a non-negative safe integer");
  let label = "";
  do {
    label = String.fromCharCode(65 + index % 26) + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return label;
}
