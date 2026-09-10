import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { WalletCampaign } from "@prisma/client";
import { walletCampaignSchema } from "@kudos/shared-types";
import { WalletCampaignsAdminService } from "./wallet-campaigns-admin.service";
import type { PrismaService } from "../prisma/prisma.service";
import type {
  PlatformNotificationService,
  PlatformNotifyPayload,
} from "../platform-notifications/platform-notification.service";

/**
 * The operator's half of wallet campaigns. Everything here is a rule about what
 * may change and when — the money itself is `creditCampaign`'s job and is
 * covered by wallet-campaign-credit.e2e-spec.
 *
 * October 2026 is used throughout on purpose: its window starts in BST and ends
 * in GMT, so a window built by adding fixed hours instead of doing calendar
 * arithmetic comes out an hour wrong at one end.
 */
const OCTOBER: WalletCampaign = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "October welcome",
  amountMinor: 500,
  // 1 Oct 2026 London midnight is 30 Sep 23:00Z (BST); 1 Nov is 00:00Z (GMT).
  startsAt: new Date("2026-09-30T23:00:00.000Z"),
  endsAt: new Date("2026-11-01T00:00:00.000Z"),
  budgetMinor: 100_000,
  status: "draft",
  createdByUserId: "user-1",
  createdAt: new Date("2026-09-01T09:00:00.000Z"),
  updatedAt: new Date("2026-09-01T09:00:00.000Z"),
};

/** The two write shapes the service builds, typed so a test can read them back
 *  without `any` — the arguments are the assertion in half of these tests. */
interface CreateArgs {
  data: Record<string, unknown>;
}
interface UpdateManyArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

/**
 * The first element, or a failure that says so.
 *
 * `undefined` sliding into an expectation is how a test passes while asserting
 * nothing — `expect(undefined?.status).toBe(...)` on an empty list is green.
 */
function first<T>(items: T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error("expected at least one item");
  return head;
}

function makeService(campaign: WalletCampaign | null, spentMinor = 0, spentCount = 0) {
  const walletCampaign = {
    findUnique: jest.fn().mockResolvedValue(campaign),
    findMany: jest.fn().mockResolvedValue(campaign ? [campaign] : []),
    create: jest.fn<Promise<WalletCampaign>, [CreateArgs]>(({ data }) =>
      Promise.resolve({ ...OCTOBER, ...data }),
    ),
    updateMany: jest
      .fn<Promise<{ count: number }>, [UpdateManyArgs]>()
      .mockResolvedValue({ count: 1 }),
  };
  const walletLedgerEntry = {
    groupBy: jest.fn().mockResolvedValue(
      spentCount === 0
        ? []
        : [
            {
              reference: `campaign:${OCTOBER.id}`,
              _count: { _all: spentCount },
              _sum: { amountMinor: spentMinor },
            },
          ],
    ),
  };
  const notifyAllAdmins = jest
    .fn<Promise<boolean>, [PlatformNotifyPayload]>()
    .mockResolvedValue(true);
  const service = new WalletCampaignsAdminService(
    { walletCampaign, walletLedgerEntry } as unknown as PrismaService,
    { notifyAllAdmins } as unknown as PlatformNotificationService,
  );
  return { service, walletCampaign, notifyAllAdmins };
}

describe("WalletCampaignsAdminService", () => {
  describe("the window an operator types", () => {
    it("stores inclusive London days as a half-open instant window, across the DST change", async () => {
      const { service, walletCampaign } = makeService(null);

      await service.create("user-1", {
        name: "October welcome",
        amountMinor: 500,
        startsOn: "2026-10-01",
        endsOn: "2026-10-31",
        budgetMinor: 100_000,
      });

      const { data } = first(walletCampaign.create.mock.calls)[0];
      // 1 October begins at 23:00 the day before, because London is on BST.
      expect(data.startsAt).toEqual(new Date("2026-09-30T23:00:00.000Z"));
      // The window ends when 1 November begins — and by then the clocks have
      // gone back, so that is midnight UTC, not 23:00 on 31 October.
      expect(data.endsAt).toEqual(new Date("2026-11-01T00:00:00.000Z"));
      expect(data.status).toBe("draft");
    });

    it("reads the stored window back as the same two days", async () => {
      const { service } = makeService(OCTOBER);
      const campaign = first(await service.list());
      expect(campaign.startsOn).toBe("2026-10-01");
      expect(campaign.endsOn).toBe("2026-10-31");
    });

    it("refuses a window that ends before it starts", async () => {
      const { service } = makeService(null);
      await expect(
        service.create("user-1", {
          name: "Backwards",
          amountMinor: 500,
          startsOn: "2026-10-31",
          endsOn: "2026-10-01",
          budgetMinor: 100_000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("what a campaign is allowed to say it has spent", () => {
    it("counts and sums from the ledger rather than from the campaign", async () => {
      const { service } = makeService(OCTOBER, 3_500, 7);
      const campaign = first(await service.list());
      expect(campaign.creditedCount).toBe(7);
      expect(campaign.creditedMinor).toBe(3_500);
    });

    it("matches the shape the web is typed against", async () => {
      const { service } = makeService(OCTOBER, 3_500, 7);
      const campaign = first(await service.list());
      // The web imports this schema's type. A field renamed on one side only
      // would otherwise be caught by nothing until a page rendered "undefined".
      expect(() => walletCampaignSchema.parse(campaign)).not.toThrow();
    });
  });

  describe("editing", () => {
    it("lets a draft's amount and dates change", async () => {
      const { service, walletCampaign } = makeService(OCTOBER);
      await service.update(OCTOBER.id, { amountMinor: 1_000, endsOn: "2026-11-30" });
      const { data } = first(walletCampaign.updateMany.mock.calls)[0];
      expect(data.amountMinor).toBe(1_000);
      expect(data.endsAt).toEqual(new Date("2026-12-01T00:00:00.000Z"));
    });

    it("refuses to change the offer once the campaign has left draft", async () => {
      const { service } = makeService({ ...OCTOBER, status: "live" });
      await expect(service.update(OCTOBER.id, { amountMinor: 1_000 })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.update(OCTOBER.id, { startsOn: "2026-10-05" })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.update(OCTOBER.id, { endsOn: "2026-11-30" })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("still lets a live campaign be renamed and its budget moved", async () => {
      const { service, walletCampaign } = makeService({ ...OCTOBER, status: "live" }, 2_000, 4);
      await service.update(OCTOBER.id, { name: "October welcome ", budgetMinor: 200_000 });
      const { data } = first(walletCampaign.updateMany.mock.calls)[0];
      expect(data.name).toBe("October welcome");
      expect(data.budgetMinor).toBe(200_000);
      expect(data.status).toBeUndefined();
    });

    it("refuses a budget below what has already been paid out", async () => {
      const { service } = makeService({ ...OCTOBER, status: "live" }, 5_000, 10);
      await expect(service.update(OCTOBER.id, { budgetMinor: 4_000 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("restarts an exhausted campaign when the budget is topped up", async () => {
      const exhausted = { ...OCTOBER, status: "exhausted" as const, budgetMinor: 5_000 };
      const { service, walletCampaign, notifyAllAdmins } = makeService(exhausted, 5_000, 10);

      await service.update(OCTOBER.id, { budgetMinor: 20_000 });

      const call = first(walletCampaign.updateMany.mock.calls)[0];
      expect(call.data.status).toBe("live");
      // Guarded on the status we read, so the sweep can't be overwritten.
      expect(call.where).toEqual({ id: OCTOBER.id, status: "exhausted" });
      expect(notifyAllAdmins).toHaveBeenCalled();
    });

    it("leaves it exhausted when the top-up isn't enough for one more credit", async () => {
      const exhausted = { ...OCTOBER, status: "exhausted" as const, budgetMinor: 5_000 };
      const { service, walletCampaign } = makeService(exhausted, 5_000, 10);
      // £5 spent + £5 per account needs at least £10 of budget to pay one more.
      await service.update(OCTOBER.id, { budgetMinor: 5_400 });
      expect(first(walletCampaign.updateMany.mock.calls)[0].data.status).toBeUndefined();
    });

    it("refuses to edit an ended campaign at all", async () => {
      const { service } = makeService({ ...OCTOBER, status: "ended" });
      await expect(service.update(OCTOBER.id, { name: "Renamed" })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("reports a concurrent change rather than silently doing nothing", async () => {
      const { service, walletCampaign } = makeService(OCTOBER);
      walletCampaign.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.update(OCTOBER.id, { name: "Renamed" })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("404s on a campaign that isn't there", async () => {
      const { service } = makeService(null);
      await expect(service.update(OCTOBER.id, { name: "Renamed" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("status", () => {
    it.each([
      ["draft", "live"],
      ["draft", "ended"],
      ["live", "paused"],
      ["live", "ended"],
      ["paused", "live"],
      ["paused", "ended"],
      ["exhausted", "ended"],
    ] as const)("allows %s → %s", async (from, to) => {
      const { service, walletCampaign } = makeService({ ...OCTOBER, status: from });
      await service.setStatus(OCTOBER.id, to);
      expect(walletCampaign.updateMany).toHaveBeenCalledWith({
        where: { id: OCTOBER.id, status: from },
        data: { status: to },
      });
    });

    it.each([
      ["ended", "live"],
      ["ended", "paused"],
      ["exhausted", "paused"],
      ["draft", "paused"],
    ] as const)("refuses %s → %s", async (from, to) => {
      const { service, walletCampaign } = makeService({ ...OCTOBER, status: from });
      await expect(service.setStatus(OCTOBER.id, to)).rejects.toBeInstanceOf(ConflictException);
      expect(walletCampaign.updateMany).not.toHaveBeenCalled();
    });

    it("says how to restart an exhausted campaign instead of just refusing", async () => {
      const { service } = makeService({ ...OCTOBER, status: "exhausted" });
      await expect(service.setStatus(OCTOBER.id, "live")).rejects.toThrow(/raise the budget/i);
    });

    it("is a no-op when the campaign is already in that state", async () => {
      const { service, walletCampaign } = makeService({ ...OCTOBER, status: "live" });
      await service.setStatus(OCTOBER.id, "live");
      expect(walletCampaign.updateMany).not.toHaveBeenCalled();
    });

    it("tells every operator when a campaign starts giving money away", async () => {
      const { service, notifyAllAdmins } = makeService(OCTOBER);
      await service.setStatus(OCTOBER.id, "live");
      expect(notifyAllAdmins).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "wallet_campaign_live",
          // Keyed on the campaign, so a pause-and-resume doesn't file it twice.
          entityId: OCTOBER.id,
        }),
      );
      // The operator reading the alert needs the offer, not just its name.
      const body = notifyAllAdmins.mock.lastCall?.[0].body;
      expect(body).toContain("2026-10-01");
      expect(body).toContain("2026-10-31");
      expect(body).toContain("£5.00");
    });

    it("does not announce a pause or an end", async () => {
      for (const status of ["paused", "ended"] as const) {
        const { service, notifyAllAdmins } = makeService({ ...OCTOBER, status: "live" });
        await service.setStatus(OCTOBER.id, status);
        expect(notifyAllAdmins).not.toHaveBeenCalled();
      }
    });

    it("reports a concurrent change rather than silently doing nothing", async () => {
      const { service, walletCampaign } = makeService({ ...OCTOBER, status: "live" });
      walletCampaign.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.setStatus(OCTOBER.id, "paused")).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
