import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

/** Postgres serialization failure — Prisma surfaces it as this known code. */
const SERIALIZATION_FAILURE = "P2034";

/**
 * Attempts before a serialization conflict is surfaced to the caller.
 *
 * 5, not 3: under real contention (several requests racing on the same account)
 * three attempts can all lose the race, and the guarded write then fails for a
 * reason that has nothing to do with the request itself.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Seconds the client is told to wait before retrying an exhausted conflict. */
export const SERIALIZATION_RETRY_AFTER_SECONDS = 1;

/**
 * The first retry window, in milliseconds. The window doubles per attempt and
 * the actual wait is drawn randomly from inside it ("full jitter").
 *
 * Deliberately tiny. This exists to *decorrelate* two restarts, not to wait
 * anybody out: these are database transactions holding a connection while a
 * customer waits on a wallet debit, so a second of backoff would simply move
 * the damage from conflicts to latency. A few milliseconds of randomness is
 * what breaks the lockstep.
 */
export const SERIALIZATION_RETRY_BASE_MS = 5;

/** The retry window never grows past this, in milliseconds. */
export const SERIALIZATION_RETRY_MAX_MS = 50;

/**
 * How long to wait before retrying after a lost race. Pure given `random`.
 *
 * Retries used to fire with no delay at all, which is the worst thing two
 * conflicting transactions can do: Postgres aborts one of them, it restarts at
 * the same instant it aborted, and it collides with the same partner again —
 * still in phase. A loser can exhaust every attempt inside the window in which
 * the winner is still committing, and the caller gets a 503 for a write that
 * would have succeeded a millisecond later. That is exactly how a concurrent
 * wallet-campaign credit failed all five attempts in CI while needing only one
 * retry on a quieter machine.
 *
 * Full jitter rather than a fixed backoff: a fixed wait moves both restarts
 * along the timeline together and leaves them in phase, so it fixes nothing.
 * The randomness is the fix; the widening window just makes a repeat collision
 * progressively less likely.
 */
export function serializationRetryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const window = Math.min(
    SERIALIZATION_RETRY_BASE_MS * 2 ** (attempt - 1),
    SERIALIZATION_RETRY_MAX_MS,
  );
  return Math.round(random() * window);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunSerializableOptions {
  /** Overridable so tests can exhaust the retries without five round trips. */
  maxAttempts?: number;
  /** Source of the retry jitter. Overridable so a test can pin the wait to a
   *  known quantity instead of asserting on whatever the die rolled. */
  random?: () => number;
}

/**
 * Raised when a Serializable transaction lost the write race on every attempt.
 *
 * Deliberately a 503 and not a 500: nothing is wrong with the request, and
 * nothing is wrong with the server's logic — two transactions touched the same
 * rows at the same time and Postgres aborted one of them. The honest answer is
 * "couldn't apply that right now, try again", which is what 503 plus
 * `Retry-After` means. It is also deliberately not the 409 we return for a
 * genuine duplicate: a client that retries a 409 will keep getting it, whereas
 * retrying this one is expected to succeed.
 *
 * SerializationConflictFilter turns it into the response, including the header.
 */
export class SerializationConflictException extends ServiceUnavailableException {
  readonly retryAfterSeconds = SERIALIZATION_RETRY_AFTER_SECONDS;

  constructor(readonly attempts: number) {
    super("The server is busy with a conflicting change. Please retry.");
  }
}

/**
 * Runs `fn` in a Serializable transaction, retrying on a write-conflict (P2034)
 * up to `maxAttempts`. Serializable is the codebase's concurrency primitive for
 * any read-then-write that must not race (wallet debits, recipient-cap checks,
 * auto-send). Non-serialization errors propagate immediately, aborting the
 * transaction.
 *
 * When the retries genuinely exhaust, the raw P2034 is **not** propagated: it
 * would reach the client as a 500, claiming a server fault for what is really
 * "this collided, ask again". See SerializationConflictException.
 */
export async function runSerializable<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: RunSerializableOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const random = options.random ?? Math.random;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === SERIALIZATION_FAILURE;
      if (!isSerializationFailure) {
        throw error;
      }
      if (attempt === maxAttempts) {
        throw new SerializationConflictException(maxAttempts);
      }
      // Not immediately: see `serializationRetryDelayMs`. Restarting the instant
      // we aborted puts us back into the collision we just lost.
      await sleep(serializationRetryDelayMs(attempt, random));
    }
  }
  /* istanbul ignore next -- unreachable: loop always returns or throws */
  throw new Error("Unreachable");
}
