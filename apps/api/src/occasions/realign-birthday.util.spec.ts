import { isOccasionUniqueViolation, realignBirthdayOccasion } from "./realign-birthday.util";

/**
 * The race path: something claims the corrected date between the read that
 * checks for a blocker and the write that moves the row onto it. The blocker
 * check covers every row it read, so this is the residue — and correcting a
 * date of birth must not 500 on it (ADR 0185).
 *
 * This function used to recover from it here, by clearing the row that could
 * not move. **That could never have run.** In production the realign is always
 * inside a transaction, and Postgres marks the block aborted the moment the
 * unique key refuses a statement — so the recovery's own writes failed with
 * 25P02 and the customer got a 500 anyway. The test passed because the stub
 * below is a plain client with no transaction: it differed from production in
 * exactly the way that mattered.
 *
 * The collision is now propagated and the *caller* retries on a fresh
 * transaction, where the row that claimed the date is visible and the blocker
 * branch handles it with no race at all. See ADR 0229.
 */
describe("realignBirthdayOccasion under a concurrent claim", () => {
  const RECIPIENT = { accountId: "acc-1", recipientId: "rec-1" };

  /** A birthday whose next occurrence is a fixed distance from `now`. */
  const now = new Date("2026-09-15T09:00:00.000Z");
  const dateOfBirth = new Date("1996-10-23T00:00:00.000Z");

  function prismaStub(overrides: {
    // `source` is part of the real row: the realign only moves or discards
    // rows it owns, so a stub without it describes no row the function acts on.
    rows: { id: string; status: string; occasionDate: Date; source: string }[];
    onUpdate: () => never | void;
  }) {
    const deleted: string[][] = [];
    const retired: string[][] = [];
    const client = {
      occasion: {
        findMany: () => Promise.resolve(overrides.rows),
        update: () => Promise.resolve(overrides.onUpdate()),
        updateMany: ({ where }: { where: { id: { in: string[] } } }) => {
          retired.push(where.id.in);
          return Promise.resolve({ count: where.id.in.length });
        },
        deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
          deleted.push(where.id.in);
          return Promise.resolve({ count: where.id.in.length });
        },
        createMany: () => Promise.resolve({ count: 1 }),
      },
    };
    return { client, deleted, retired };
  }

  it("propagates the collision rather than trying to recover inside the transaction", async () => {
    const { client } = prismaStub({
      // One live row, on the wrong date, and nothing blocking the target — so
      // the move is attempted.
      rows: [
        {
          id: "keeper",
          status: "approved",
          occasionDate: new Date("2026-11-01T00:00:00.000Z"),
          source: "recurring_per_recipient",
        },
      ],
      onUpdate: () => {
        const error: Error & { code?: string } = new Error("Unique constraint failed");
        error.code = "P2002";
        throw error;
      },
    });

    await expect(
      realignBirthdayOccasion(
        client as unknown as Parameters<typeof realignBirthdayOccasion>[0],
        { ...RECIPIENT, dateOfBirth },
        now,
      ),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("recognises the collision for the caller that retries on it", () => {
    // The caller's retry turns on this, so it is worth one line: a P2002 is
    // retried, anything else is a real failure and goes up.
    expect(isOccasionUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isOccasionUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isOccasionUniqueViolation(null)).toBe(false);
  });

  it("still surfaces an error that is not a unique-key collision", async () => {
    // Swallowing everything here would hide a real database failure behind a
    // silently unchanged birthday.
    const { client } = prismaStub({
      rows: [
        {
          id: "keeper",
          status: "scheduled",
          occasionDate: new Date("2026-11-01T00:00:00.000Z"),
          source: "recurring_per_recipient",
        },
      ],
      onUpdate: () => {
        throw new Error("connection reset");
      },
    });

    await expect(
      realignBirthdayOccasion(
        client as unknown as Parameters<typeof realignBirthdayOccasion>[0],
        { ...RECIPIENT, dateOfBirth },
        now,
      ),
    ).rejects.toThrow("connection reset");
  });
});
