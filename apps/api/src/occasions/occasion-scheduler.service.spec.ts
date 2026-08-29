import { OccasionSchedulerService } from "./occasion-scheduler.service";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * The scheduler runs across every tenant's contacts, so it must page through the
 * tables rather than load them whole. These tests drive the keyset-pagination
 * loop with a mocked Prisma client to prove it advances the cursor and stops on
 * a short page — the behaviour that keeps memory flat as the platform grows.
 * (Behavioural correctness — which occasions get created/promoted — is covered
 * by occasion-scheduler.e2e-spec.ts against a real database.)
 */
describe("OccasionSchedulerService pagination", () => {
  const PAGE = 1_000;

  function makeRecipients(count: number, offset = 0) {
    return Array.from({ length: count }, (_unused, i) => ({
      id: `r${offset + i}`,
      accountId: "acc",
      dateOfBirth: new Date("2015-06-15"),
    }));
  }

  function buildService() {
    // Typed params so inspecting `.mock.calls[n][0]` (the findMany args) is safe.
    const recipientFindMany = jest.fn<Promise<unknown[]>, [Record<string, unknown>]>();
    const keyDateFindMany = jest.fn().mockResolvedValue([]);
    const occasionCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    // Three distinct counts so the summary can't pass by two of its numbers
    // happening to match: promotion runs first, then the past-approval sweep,
    // then the past-event sweep.
    const occasionUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 7 })
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValue({ count: 0 });

    const prisma = {
      recipient: { findMany: recipientFindMany },
      recipientKeyDate: { findMany: keyDateFindMany },
      occasion: { createMany: occasionCreateMany, updateMany: occasionUpdateMany },
    } as unknown as PrismaService;

    const service = new OccasionSchedulerService(prisma);
    return { service, recipientFindMany, keyDateFindMany, occasionCreateMany, occasionUpdateMany };
  }

  it("stops after a single short page (fewer rows than the page size)", async () => {
    const { service, recipientFindMany, occasionCreateMany, occasionUpdateMany } = buildService();
    recipientFindMany.mockResolvedValueOnce(makeRecipients(3));

    const summary = await service.scheduleBirthdayOccasions();

    // One page fetched, one createMany written, no second fetch (short page ends it).
    expect(recipientFindMany).toHaveBeenCalledTimes(1);
    expect(occasionCreateMany).toHaveBeenCalledTimes(1);
    // The first page carries no cursor.
    const firstCallArgs = recipientFindMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstCallArgs).not.toHaveProperty("cursor");
    // Three set-based UPDATEs: promote into the window, retire the approvals
    // whose date has been, then retire the hand-added events no timer ever
    // promotes. The run reports each alongside what it saw, so an operator
    // triggering it by hand gets the same numbers the nightly run logs.
    expect(occasionUpdateMany).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({
      recipients: 3,
      keyDates: 0,
      promoted: 7,
      lapsed: 4,
      missedEvents: 2,
    });
  });

  it("advances the keyset cursor across a full page and stops on the next short page", async () => {
    const { service, recipientFindMany, occasionCreateMany } = buildService();
    recipientFindMany
      .mockResolvedValueOnce(makeRecipients(PAGE)) // full page → fetch again
      .mockResolvedValueOnce(makeRecipients(2, PAGE)); // short page → stop

    await service.scheduleBirthdayOccasions();

    expect(recipientFindMany).toHaveBeenCalledTimes(2);
    expect(occasionCreateMany).toHaveBeenCalledTimes(2);

    // Second fetch resumes from the last id of the first page, skipping the cursor row.
    const secondCallArgs = recipientFindMany.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(secondCallArgs).toMatchObject({
      cursor: { id: `r${PAGE - 1}` },
      skip: 1,
      take: PAGE,
    });
  });

  it("does not write when a page comes back empty", async () => {
    const { service, recipientFindMany, keyDateFindMany, occasionCreateMany } = buildService();
    recipientFindMany.mockResolvedValueOnce([]);
    keyDateFindMany.mockResolvedValueOnce([]);

    await service.scheduleBirthdayOccasions();

    expect(recipientFindMany).toHaveBeenCalledTimes(1);
    expect(occasionCreateMany).not.toHaveBeenCalled();
  });
});
