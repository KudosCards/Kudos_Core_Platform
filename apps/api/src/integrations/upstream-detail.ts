/**
 * What the upstream actually said, made safe to show a customer.
 *
 * A CRM that refuses a request almost always explains why in the response body,
 * and every client here threw that away and reported the bare status instead.
 * The cost is not hypothetical: a GoHighLevel connection failed nightly for five
 * weeks saying only "GoHighLevel rejected the access token", while the real
 * cause — a Marketplace app sitting `Disapproved` — was in the body all along.
 * Four reconnects and a support thread later, nobody was any wiser.
 *
 * The result of this goes into `lastSyncStatus`, which the customer reads on
 * their integrations page, so it is one line, bounded, and redacted.
 * See ADR 0212.
 */

/** How much of the upstream's message to keep. `lastSyncStatus` is capped at
 * 200 characters including our own hint, so this has to leave room. */
export const UPSTREAM_DETAIL_LIMIT = 120;

export const REDACTED = "[redacted]";

/** Fields an API is likely to put its human-readable reason in. Ordered: the
 * first one present and non-empty wins. */
const MESSAGE_FIELDS = ["message", "error_description", "error", "detail"] as const;

export interface UpstreamDetailOptions {
  /**
   * Values that must never survive into the stored status — the access token we
   * sent, typically. Matched literally rather than by shape, because a token has
   * no distinguishing format and guessing at one is how a leak gets missed
   * (the same reasoning as redact-url-tokens.ts).
   */
  secrets?: readonly (string | undefined | null)[];
  limit?: number;
}

/**
 * Read an error response's body and reduce it to a single safe line.
 *
 * Never throws and never rejects: this runs on a path that is already failing,
 * and a body that cannot be read must not replace the caller's real error with
 * one about reading it. An unreadable or empty body gives "".
 */
export async function upstreamDetail(
  response: Response,
  options: UpstreamDetailOptions = {},
): Promise<string> {
  const raw = await response.text().catch(() => "");
  return formatUpstreamDetail(raw, options);
}

/** The pure half, so the shaping can be tested without a Response. */
export function formatUpstreamDetail(raw: string, options: UpstreamDetailOptions = {}): string {
  const limit = options.limit ?? UPSTREAM_DETAIL_LIMIT;
  let text = extractMessage(raw);

  for (const secret of options.secrets ?? []) {
    // A short "secret" would redact ordinary words out of the message; a real
    // credential is never this short.
    if (!secret || secret.length < 8) continue;
    text = text.split(secret).join(REDACTED);
  }

  // One line: a JSON blob or an HTML error page is unreadable in a status field.
  text = text.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** Prefer the API's own message field over the raw envelope — `{"message":"The
 * token does not have access"}` reads far better than the JSON around it. */
function extractMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return trimmed;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object") {
      return trimmed;
    }
    const record = parsed as Record<string, unknown>;
    for (const field of MESSAGE_FIELDS) {
      const value = record[field];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
      // Some APIs nest one level: { error: { message: "…" } }
      if (value !== null && typeof value === "object") {
        const nested = (value as Record<string, unknown>).message;
        if (typeof nested === "string" && nested.trim().length > 0) {
          return nested.trim();
        }
      }
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Join our hint and the upstream's words into one sentence.
 *
 * The hint comes first deliberately: `lastSyncStatus` is truncated at 200
 * characters, and the half a customer can act on must be the half that survives.
 */
export function withUpstreamDetail(summary: string, detail: string): string {
  return detail ? `${summary} — ${detail}` : summary;
}
