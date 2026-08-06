import { Transform } from "class-transformer";

/**
 * For an *optional* string field: treat a blank submission (empty or
 * whitespace-only) as "not provided" by mapping it to `undefined`.
 *
 * Why: web forms send optional inputs as `""` when left empty, and
 * `@IsOptional()` only skips `null`/`undefined` — so an empty string would still
 * hit `@Length(1, …)` and fail validation (e.g. an empty "Address line 2"
 * rejecting a whole checkout). Normalising to `undefined` lets `@IsOptional()`
 * skip it and the value persist as null rather than an empty string.
 *
 * Apply ABOVE the validation decorators so the transform runs first.
 */
export function BlankToUndefined(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  );
}
