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

export interface RunSerializableOptions {
  /** Overridable so tests can exhaust the retries without five round trips. */
  maxAttempts?: number;
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
    }
  }
  /* istanbul ignore next -- unreachable: loop always returns or throws */
  throw new Error("Unreachable");
}
