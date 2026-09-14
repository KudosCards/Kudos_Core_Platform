import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import {
  runSerializable,
  serializationRetryDelayMs,
  SerializationConflictException,
  SERIALIZATION_RETRY_AFTER_SECONDS,
  SERIALIZATION_RETRY_BASE_MS,
  SERIALIZATION_RETRY_MAX_MS,
} from "./run-serializable";

/**
 * Serializable retries guard the money paths (wallet debits, batch orders,
 * auto-send, webhooks) and the recipient-cap check, and had no test coverage at
 * all. These pin what the helper promises its callers: retry a write-conflict,
 * never retry anything else, and — when the conflict outlives the retries —
 * fail as "busy, try again" rather than as a server fault.
 */

function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("could not serialize access", {
    code: "P2034",
    clientVersion: "test",
  });
}

/** A PrismaService stub whose $transaction runs the callback directly. */
function prismaStub(transaction: jest.Mock): PrismaService {
  return { $transaction: transaction } as unknown as PrismaService;
}

describe("runSerializable", () => {
  it("returns the result of a first-attempt success", async () => {
    const transaction = jest.fn().mockResolvedValue("ok");

    await expect(
      runSerializable(prismaStub(transaction), () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("retries a serialization failure and returns the attempt that wins", async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValue("ok");

    await expect(
      runSerializable(prismaStub(transaction), () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("retries up to five times by default before giving up", async () => {
    const transaction = jest.fn().mockRejectedValue(serializationFailure());

    await expect(
      runSerializable(prismaStub(transaction), () => Promise.resolve("never")),
    ).rejects.toBeInstanceOf(SerializationConflictException);
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it("gives up after maxAttempts", async () => {
    const transaction = jest.fn().mockRejectedValue(serializationFailure());

    await expect(
      runSerializable(prismaStub(transaction), () => Promise.resolve("never"), { maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(SerializationConflictException);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("surfaces an exhausted conflict as 503 + Retry-After, not the raw P2034", async () => {
    // The defect this closes: a P2034 that outlived its retries reached the
    // client as a 500, claiming a server fault for what is really "two writes
    // collided, ask again". The request was never wrong, so 5xx-as-bug is a lie
    // and there is nothing for the caller to fix by changing it.
    const transaction = jest.fn().mockRejectedValue(serializationFailure());

    const error = await runSerializable(prismaStub(transaction), () => Promise.resolve("never"), {
      maxAttempts: 3,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SerializationConflictException);
    const conflict = error as SerializationConflictException;
    expect(conflict.getStatus()).toBe(503);
    expect(conflict.attempts).toBe(3);
    expect(conflict.retryAfterSeconds).toBe(SERIALIZATION_RETRY_AFTER_SECONDS);
  });

  it("propagates a non-serialization error immediately, without retrying", async () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    const transaction = jest.fn().mockRejectedValue(uniqueViolation);

    await expect(
      runSerializable(prismaStub(transaction), () => Promise.resolve("never")),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("runs the transaction at Serializable isolation", async () => {
    const transaction = jest.fn().mockResolvedValue("ok");
    await runSerializable(prismaStub(transaction), () => Promise.resolve("ok"));
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("waits between attempts, so two collided transactions do not restart together", async () => {
    // The defect: retries fired with no delay at all. Two transactions that
    // conflict abort at the same moment and restart at the same moment, so they
    // collide again — in phase — and can burn every attempt inside the window
    // the winner is still committing in. That is what surfaced as a 503 on a
    // wallet campaign credit in CI, where five attempts in a row lost.
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValue("ok");

    const started = Date.now();
    // `random: () => 1` takes the top of each window, so the assertion is on a
    // known quantity rather than on whatever the die rolled.
    await runSerializable(prismaStub(transaction), () => Promise.resolve("ok"), {
      random: () => 1,
    });
    const elapsed = Date.now() - started;

    // Two losses at the top of the first two windows: 5ms + 10ms. Asserted with
    // room underneath, because a timer may overshoot but never undershoots.
    expect(elapsed).toBeGreaterThanOrEqual(SERIALIZATION_RETRY_BASE_MS * 3 * 0.8);
  });
});

/**
 * The delay policy itself. Small on purpose: these are database transactions
 * holding a connection, and the point is to *decorrelate* two restarts, not to
 * wait anybody out. A few milliseconds of randomness does that; a second of
 * backoff would just move the damage from conflicts to latency.
 */
describe("serializationRetryDelayMs", () => {
  it("draws from a window that widens with each attempt", () => {
    // Full jitter: the delay is somewhere in [0, window), and the window
    // doubles. Two losers drawing from a widening range separate quickly.
    expect(serializationRetryDelayMs(1, () => 1)).toBe(SERIALIZATION_RETRY_BASE_MS);
    expect(serializationRetryDelayMs(2, () => 1)).toBe(SERIALIZATION_RETRY_BASE_MS * 2);
    expect(serializationRetryDelayMs(3, () => 1)).toBe(SERIALIZATION_RETRY_BASE_MS * 4);
  });

  it("never waits longer than the cap, however many attempts have failed", () => {
    // A retry that slept for seconds would be worse than the conflict: the
    // caller is a customer waiting on a wallet debit.
    expect(serializationRetryDelayMs(20, () => 1)).toBe(SERIALIZATION_RETRY_MAX_MS);
    expect(SERIALIZATION_RETRY_MAX_MS).toBeLessThanOrEqual(100);
  });

  it("is a random draw, not a fixed wait", () => {
    // The whole point. A fixed delay moves two in-phase restarts along the
    // timeline together and leaves them in phase; only a random one separates
    // them. If this ever returns a constant, the fix is decorative.
    const draws = new Set(
      Array.from({ length: 200 }, () => serializationRetryDelayMs(4, Math.random)),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it("never asks to wait a negative amount of time", () => {
    expect(serializationRetryDelayMs(1, () => 0)).toBe(0);
    expect(serializationRetryDelayMs(5, () => 0)).toBe(0);
  });
});
