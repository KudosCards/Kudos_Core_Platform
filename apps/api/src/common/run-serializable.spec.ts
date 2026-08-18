import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import {
  runSerializable,
  SerializationConflictException,
  SERIALIZATION_RETRY_AFTER_SECONDS,
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
});
