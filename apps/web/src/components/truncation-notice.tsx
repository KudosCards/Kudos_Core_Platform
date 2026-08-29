/**
 * "Showing the first 50 of 137" — said out loud, where a list is a page of
 * something longer.
 *
 * Every paginated read on this platform carries a `total`, and seven screens
 * fetched one page, rendered it, and threw that number away. A reader has no way
 * to tell a short list from a truncated one, so a truncated one reads as the
 * whole truth.
 *
 * That is not hypothetical. The calendar did exactly this and a school reported
 * their month "stopping" on 17 September — it was drawing one page of a hundred
 * and had said nothing (ADR 0173). The rule that came out of it was: never
 * truncate in silence. This is that rule, made reusable, for the screens that
 * were still doing it.
 *
 * Renders nothing when everything fits, which is the ordinary case.
 */
export function TruncationNotice({
  shown,
  total,
  unit,
  hint,
}: {
  shown: number;
  total: number;
  /** Plural noun for the thing being listed — "orders", "approvals". */
  unit: string;
  /** How to reach the rest. Omit when there is genuinely nothing to suggest. */
  hint?: string;
}) {
  if (shown >= total) return null;
  const n = (value: number) => value.toLocaleString("en-GB");
  return (
    <p className="notice notice-warning">
      Showing the first {n(shown)} of {n(total)} {unit}.{hint ? ` ${hint}` : ""}
    </p>
  );
}
