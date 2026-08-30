import { Logger } from "@nestjs/common";

/**
 * Every outbound HTTP call goes through here, for two reasons.
 *
 * A deadline: `fetch` has no default timeout, so a hung upstream holds the
 * caller open until the socket eventually gives up — minutes, in a request path
 * with a customer waiting on it, or a nightly cron that never finishes.
 *
 * A retry, but only where it is safe: a 429 or a 5xx is the upstream saying
 * "rate-limited" or "briefly broken", not "your request was wrong", and trying
 * again shortly usually works. That is opt-in per call site — see `maxAttempts`.
 */

/** Deadline applied to each attempt when a call site doesn't name its own. */
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

/** First backoff step; doubled per attempt, capped at MAX_RETRY_DELAY_MS. */
export const DEFAULT_RETRY_BASE_DELAY_MS = 500;

/** Never wait longer than this between attempts, however long the upstream's
 * Retry-After asks for — a nightly sync must still finish tonight. */
export const MAX_RETRY_DELAY_MS = 30_000;

const logger = new Logger("HttpRequest");

export interface HttpRequestOptions {
  /** Deadline for each individual attempt. */
  timeoutMs?: number;
  /**
   * Total attempts including the first — 1 (the default) means no retry.
   *
   * Only raise this for a call that is safe to repeat. A retried POST the
   * upstream had already processed duplicates the work: a second shipment
   * booked, a second email sent. Reads, and writes that are idempotent by
   * construction (a delete by id, an upsert keyed on email), are the candidates.
   */
  maxAttempts?: number;
  /** First backoff step, doubled per attempt. Ignored whenever the upstream
   * tells us when to come back via Retry-After. */
  baseDelayMs?: number;
  /** Names the upstream in retry logs (e.g. "HubSpot contacts"). */
  label?: string;
}

/** The statuses worth trying again: rate-limited, or the upstream is briefly
 * broken. Everything else — 4xx especially — will fail again identically. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * How long to wait before the next attempt.
 *
 * An upstream that sends Retry-After is telling us exactly when it will serve
 * us again, so honour it — in both the delta-seconds and the HTTP-date form —
 * rather than guessing. Exponential backoff is the fallback for when it
 * doesn't. `attempt` is 1-based: the delay after the first failure.
 */
export function retryDelayMs(
  attempt: number,
  retryAfter?: string | null,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS,
  now: number = Date.now(),
): number {
  const fromHeader = parseRetryAfter(retryAfter, now);
  if (fromHeader !== null) {
    return Math.min(fromHeader, MAX_RETRY_DELAY_MS);
  }
  return Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

/** Retry-After is either a number of seconds or an HTTP date. Anything else
 * (or a date already in the past) means "no useful instruction". */
function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` with a deadline, and optionally a bounded retry.
 *
 * The signal is owned here — that is the whole point — so callers pass the rest
 * of the request init and leave the deadline to `timeoutMs`. A timed-out or
 * failed transport throws exactly as bare `fetch` would once the attempts run
 * out, so existing error handling at the call sites is unchanged.
 */
export async function httpRequest(
  url: string | URL,
  init: Omit<RequestInit, "signal"> = {},
  options: HttpRequestOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    maxAttempts = 1,
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    label,
  } = options;
  const name = label ?? String(url);

  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // A timeout or a transport failure. Out of attempts, it's the caller's.
      if (attempt >= maxAttempts) {
        throw error;
      }
      const delay = retryDelayMs(attempt, null, baseDelayMs);
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        `${name} failed (${reason}) — retrying in ${delay}ms (attempt ${attempt} of ${maxAttempts})`,
      );
      await sleep(delay);
      continue;
    }

    if (attempt >= maxAttempts || !isRetryableStatus(response.status)) {
      return response;
    }

    const delay = retryDelayMs(attempt, response.headers?.get("retry-after"), baseDelayMs);
    logger.warn(
      `${name} returned ${response.status} — retrying in ${delay}ms (attempt ${attempt} of ${maxAttempts})`,
    );
    // Nothing will read this body; release the socket rather than leaving it
    // for the garbage collector to reclaim.
    await response.body?.cancel().catch(() => undefined);
    await sleep(delay);
  }
}
