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

/**
 * For an *optional, clearable* string field: map a blank submission (empty or
 * whitespace-only) to `null`.
 *
 * Unlike {@link BlankToUndefined}, which drops the field so a PATCH leaves the
 * column unchanged, this persists `null` — so an edit form can actively CLEAR a
 * value (e.g. remove a contact's address), and a create with a blank field
 * stores null rather than an empty string. `@IsOptional()` skips validation for
 * null, so a following `@Matches`/`@Length` only runs on a real value.
 *
 * Apply ABOVE the validation decorators so the transform runs first.
 */
export function BlankToNull(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === "string" && value.trim() === "" ? null : value,
  );
}
