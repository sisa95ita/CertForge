import type { ValueTransformer } from "typeorm";

// Keep the legacy TEXT representation, including nulls in nullable columns.
export const jsonText: ValueTransformer = {
  to: (value: unknown) => value == null ? value : JSON.stringify(value),
  from: (value: string | null) => value == null ? value : JSON.parse(value),
};

export const integerBoolean: ValueTransformer = {
  to: (value: boolean | null) => value == null ? value : value ? 1 : 0,
  from: (value: number | null) => value == null ? value : Boolean(value),
};
