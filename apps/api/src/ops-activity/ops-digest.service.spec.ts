import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { EmailClient } from "../email/email.client";
import type { EnvConfig } from "../config/env.schema";
import type { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { OpsDigestService } from "./ops-digest.service";

/**
 * The daily digest, unit-tested against mocked queries — no DB. What these pin
 * is the part that would be silently wrong rather than loudly broken: the
 * window it reports, who it goes to, and the two things that must not be
 * counted as revenue or as a sign-up.
 */
/** The first argument of a mock's first call, typed. `mock.calls` is `any[]`,
 *  which the lint rules (rightly) won't let us index into blind. Throws rather
 *  than returning undefined, so a test that never called it fails on that
 *  rather than on a confusing property access. */
function firstArg<T>(mock: jest.Mock): T {
  const calls: [T][] = mock.mock.calls as [T][];
  const first = calls[0];
  if (!first) {
    throw new Error("Expected the mock to have been called");
  }
  return first[0];
}

describe("OpsDigestService", () => {
  const envConfig = {
    get: () => "https://app.kudos.test",
  } as unknown as ConfigService<EnvConfig, true>;

  interface Fixture {
    signupMemberships?: unknown[];
    paidOrders?: unknown[];
    returnCases?: { recoveryOrderId: string }[];
    posted?: { orders: number; cards: number };
    adminEmails?: (string | null)[];
  }

  function build(fixture: Fixture = {}) {
    const membershipFindMany = jest.fn().mockResolvedValue(fixture.signupMemberships ?? []);
    const batchOrderFindMany = jest.fn().mockResolvedValue(fixture.paidOrders ?? []);
    const returnCaseFindMany = jest.fn().mockResolvedValue(fixture.returnCases ?? []);
    const platformAdminFindMany = jest
      .fn()
      .mockResolvedValue((fixture.adminEmails ?? ["boss@kudos.test"]).map((email) => ({ email })));
    const queryRaw = jest.fn().mockResolvedValue([fixture.posted ?? { orders: 0, cards: 0 }]);

    const prisma = {
      membership: { findMany: membershipFindMany },
      batchOrder: { findMany: batchOrderFindMany },
      returnCase: { findMany: returnCaseFindMany },
      platformAdmin: { findMany: platformAdminFindMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;

    const sendTransactional = jest.fn().mockResolvedValue(undefined);
    const email = { sendTransactional } as unknown as EmailClient;
    const notifyAllAdmins = jest.fn().mockResolvedValue(true);
    const platformNotifications = { notifyAllAdmins } as unknown as PlatformNotificationService;

    const service = new OpsDigestService(envConfig, prisma, platformNotifications, email);
    return {
      service,
      sendTransactional,
      notifyAllAdmins,
      membershipFindMany,
      batchOrderFindMany,
      platformAdminFindMany,
    };
  }

  function order(id: string, orderNumber: number, totalMinor: number, cards = 1) {
    return {
      id,
      orderNumber,
      totalMinor,
      account: { name: "Test Centre" },
      _count: { orderRecipients: cards },
    };
  }

  function membership(name: string, type = "organisation") {
    return {
      email: "owner@test.co.uk",
      account: { id: "acc-1", name, type, planId: "free" },
    };
  }

  const NOON = new Date("2026-08-18T12:00:00.000Z");

  it("reports the previous full UTC day, not the day it runs", async () => {
    const { service, membershipFindMany } = build();

    const summary = await service.runDailyDigest(NOON);

    expect(summary.day).toBe("2026-08-17");
    const { where } = firstArg<{ where: { createdAt: { gte: Date; lt: Date } } }>(
      membershipFindMany,
    );
    expect(where.createdAt.gte.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(where.createdAt.lt.toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });

  it("counts owner memberships as sign-ups, not accounts", async () => {
    // The trap this guards: a guest one-off purchase mints a real Account row
    // with no membership, so counting accounts would report every card sale as
    // a new sign-up. Only an owner membership means somebody signed up.
    const { service, membershipFindMany } = build({
      signupMemberships: [membership("Bright Sparks")],
    });

    const summary = await service.runDailyDigest(NOON);

    expect(summary.signups).toHaveLength(1);
    expect(summary.signups[0]?.name).toBe("Bright Sparks");
    expect(firstArg<{ where: { role: string } }>(membershipFindMany).where.role).toBe("owner");
  });

  it("excludes free reprints from the order count and the revenue", async () => {
    // A returned card's reprint is created already `paid` at £0 under the Kudos
    // Promise. It is service recovery, not a sale, and counting it would
    // overstate the day's volume.
    const { service } = build({
      paidOrders: [order("ord-1", 1001, 34100), order("ord-2", 1002, 0)],
      returnCases: [{ recoveryOrderId: "ord-2" }],
    });

    const summary = await service.runDailyDigest(NOON);

    expect(summary.orders).toHaveLength(1);
    expect(summary.orders[0]?.orderNumber).toBe(1001);
    expect(summary.reprints).toBe(1);
    expect(summary.revenueMinor).toBe(34100);
  });

  it("finds orders by when they were paid, not when they were created", async () => {
    // BatchOrder has no paidAt: fulfilment jobs are created in the same
    // transaction that flips the order to paid, so their createdAt is the
    // payment moment. Keying on the order's own createdAt would silently drop
    // a checkout that was abandoned and resumed the next day.
    const { service, batchOrderFindMany } = build();

    await service.runDailyDigest(NOON);

    const { where } = firstArg<{ where: Record<string, unknown> }>(batchOrderFindMany);
    expect(where.orderRecipients).toEqual({
      some: { fulfillmentJob: { createdAt: { gte: expect.any(Date), lt: expect.any(Date) } } },
    });
    expect(where).not.toHaveProperty("createdAt");
  });

  it("emails super admins only, once per distinct address", async () => {
    const { service, sendTransactional, platformAdminFindMany } = build({
      adminEmails: ["boss@kudos.test", "BOSS@kudos.test", " second@kudos.test ", null],
    });

    const summary = await service.runDailyDigest(NOON);

    expect(firstArg<{ where: { role: string } }>(platformAdminFindMany).where.role).toBe(
      "super_admin",
    );
    expect(sendTransactional).toHaveBeenCalledTimes(2);
    expect(summary.adminsEmailed).toBe(2);
  });

  it("still sends on a day with no activity", async () => {
    // Unlike the dispatch reminder, which suppresses when there's nothing to
    // post: this is a report, and a silent morning is indistinguishable from a
    // dead cron.
    const { service, sendTransactional, notifyAllAdmins } = build();

    const summary = await service.runDailyDigest(NOON);

    expect(summary.orders).toHaveLength(0);
    expect(summary.signups).toHaveLength(0);
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1);
    expect(sendTransactional).toHaveBeenCalledTimes(1);
  });

  it("does not email twice when the day's entry already exists", async () => {
    // notifyAllAdmins returning false means another instance already recorded
    // (and therefore already emailed) this day.
    const { service, sendTransactional, notifyAllAdmins } = build();
    notifyAllAdmins.mockResolvedValueOnce(false);

    const summary = await service.runDailyDigest(NOON);

    expect(sendTransactional).not.toHaveBeenCalled();
    expect(summary.adminsEmailed).toBe(0);
  });

  it("keys the in-app entry on the reported day, so a re-run is a no-op", async () => {
    const { service, notifyAllAdmins } = build();

    await service.runDailyDigest(NOON);

    const payload = firstArg<{ kind: string; entityId: string }>(notifyAllAdmins);
    expect(payload.kind).toBe("daily_summary");
    expect(payload.entityId).toBe("2026-08-17");
  });

  it("still records the digest when every email fails", async () => {
    const { service, sendTransactional, notifyAllAdmins } = build();
    sendTransactional.mockRejectedValue(new Error("Brevo down"));

    const summary = await service.runDailyDigest(NOON);

    expect(notifyAllAdmins).toHaveBeenCalledTimes(1);
    expect(summary.adminsEmailed).toBe(0);
  });

  it("escapes account names in the email body", async () => {
    const { service, sendTransactional } = build({
      paidOrders: [order("ord-1", 1001, 250)],
      signupMemberships: [membership("<script>alert(1)</script>")],
    });

    await service.runDailyDigest(NOON);

    const { html } = firstArg<{ html: string }>(sendTransactional);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
