import type { PrismaService } from "../prisma/prisma.service";
import type { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { OpsActivityService, formatMinor } from "./ops-activity.service";

/**
 * The live operator alerts. These pin the two properties that matter when
 * something goes wrong at 2am: the alert is idempotent on the thing it's about,
 * and it can never take down the payment or signup that triggered it.
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

describe("OpsActivityService", () => {
  function build(overrides: { order?: unknown; account?: unknown } = {}) {
    const notifyAllAdmins = jest.fn().mockResolvedValue(true);
    const platformNotifications = { notifyAllAdmins } as unknown as PlatformNotificationService;
    const prisma = {
      batchOrder: { findUnique: jest.fn().mockResolvedValue(overrides.order ?? null) },
      account: { findUnique: jest.fn().mockResolvedValue(overrides.account ?? null) },
    } as unknown as PrismaService;
    const service = new OpsActivityService(prisma, platformNotifications);
    return { service, notifyAllAdmins };
  }

  const ORDER = {
    orderNumber: 1042,
    totalMinor: 34100,
    account: { name: "Bright Sparks Tuition" },
    _count: { orderRecipients: 10 },
  };

  describe("orderPaid", () => {
    it("names the order, its value and its size, and links to the ops order page", async () => {
      const { service, notifyAllAdmins } = build({ order: ORDER });

      await service.orderPaid("ord-1");

      const payload = firstArg<Record<string, string>>(notifyAllAdmins);
      expect(payload.kind).toBe("new_order");
      expect(payload.title).toBe("New order ORD-1042 — £341.00");
      expect(payload.body).toBe("10 cards for Bright Sparks Tuition.");
      expect(payload.href).toBe("/admin/orders/ord-1");
    });

    it("keys idempotency on the order, so a redelivered webhook is a no-op", async () => {
      const { service, notifyAllAdmins } = build({ order: ORDER });

      await service.orderPaid("ord-1");

      const payload = firstArg<Record<string, string>>(notifyAllAdmins);
      expect(payload.entityType).toBe("BatchOrder");
      expect(payload.entityId).toBe("ord-1");
    });

    it("singularises a one-card order", async () => {
      const { service, notifyAllAdmins } = build({
        order: { ...ORDER, _count: { orderRecipients: 1 } },
      });

      await service.orderPaid("ord-1");

      expect(firstArg<Record<string, string>>(notifyAllAdmins).body).toBe(
        "1 card for Bright Sparks Tuition.",
      );
    });

    it("is a silent no-op for an order that no longer exists", async () => {
      const { service, notifyAllAdmins } = build({ order: null });

      await expect(service.orderPaid("gone")).resolves.toBeUndefined();
      expect(notifyAllAdmins).not.toHaveBeenCalled();
    });

    it("never throws, so a notification failure can't fail the payment", async () => {
      const { service, notifyAllAdmins } = build({ order: ORDER });
      notifyAllAdmins.mockRejectedValue(new Error("db down"));

      await expect(service.orderPaid("ord-1")).resolves.toBeUndefined();
    });
  });

  describe("accountSignedUp", () => {
    it("names the account and its type, and links to the subscriber page", async () => {
      const { service, notifyAllAdmins } = build({
        account: { name: "Bright Sparks", type: "organisation", planId: "pro" },
      });

      await service.accountSignedUp("acc-1");

      const payload = firstArg<Record<string, string>>(notifyAllAdmins);
      expect(payload.kind).toBe("new_signup");
      expect(payload.title).toBe("New sign-up — Bright Sparks");
      expect(payload.body).toBe("Organisation on the pro plan.");
      expect(payload.href).toBe("/admin/subscribers/acc-1");
      expect(payload.entityId).toBe("acc-1");
    });

    it("reads an account with no plan as free rather than as blank", async () => {
      const { service, notifyAllAdmins } = build({
        account: { name: "A Person", type: "individual", planId: null },
      });

      await service.accountSignedUp("acc-2");

      expect(firstArg<Record<string, string>>(notifyAllAdmins).body).toBe(
        "Individual on the free plan.",
      );
    });

    it("never throws, so a notification failure can't fail the signup", async () => {
      const { service, notifyAllAdmins } = build({
        account: { name: "A Person", type: "individual", planId: null },
      });
      notifyAllAdmins.mockRejectedValue(new Error("db down"));

      await expect(service.accountSignedUp("acc-2")).resolves.toBeUndefined();
    });
  });

  describe("formatMinor", () => {
    it("renders to the penny with thousands separators", () => {
      expect(formatMinor(0)).toBe("£0.00");
      expect(formatMinor(250)).toBe("£2.50");
      expect(formatMinor(123456789)).toBe("£1,234,567.89");
    });
  });
});
