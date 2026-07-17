import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

/** Postgres serialization failure — Prisma surfaces it as this known code. */
const SERIALIZATION_FAILURE = "P2034";

/**
 * Runs `fn` in a Serializable transaction, retrying on a write-conflict (P2034)
 * up to `maxAttempts`. Serializable is the codebase's concurrency primitive for
 * any read-then-write that must not race (wallet debits, recipient-cap checks,
 * auto-send). Non-serialization errors propagate immediately, aborting the
 * transaction.
 */
export async function runSerializable<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === SERIALIZATION_FAILURE;
      if (!isSerializationFailure || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  /* istanbul ignore next -- unreachable: loop always returns or throws */
  throw new Error("Unreachable");
}
