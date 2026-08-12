import type { ConfigService } from "@nestjs/config";
import type { DispatchReminderConfig } from "@kudos/shared-types";
import type { PrismaService } from "../prisma/prisma.service";
import type { EmailClient } from "../email/email.client";
import type { EnvConfig } from "../config/env.schema";
import type { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import type { DispatchConfigService } from "../dispatch/dispatch-config.service";
import { DispatchReminderService } from "./dispatch-reminder.service";
import type { FulfillmentService, MustShipSummary } from "./fulfillment.service";

/**
 * The send-by-5 reminder, unit-tested against a mocked must-ship query, admin
 * list, config and email client — no DB. Proves: suppress-when-empty, one send
 * per distinct admin email, the in-app entry + "first run wins" guard, the
 * enabled/hour gate, and super-admin escalation.
 */
describe("DispatchReminderService", () => {
  const envConfig = {
    get: () => "https://app.kudos.test",
  } as unknown as ConfigService<EnvConfig, true>;

  const DEFAULT_CFG: DispatchReminderConfig = {
    enabled: true,
    sendHourUtc: 7,
    leadWorkingDays: 5,
    // High by default so escalation is off unless a test opts in.
    escalateAfterWorkingDays: 99,
    sameDayCutoffHour: 15,
  };

  function build(
    summary: MustShipSummary,
    adminEmails: (string | null)[],
    reminderConfig: Partial<DispatchReminderConfig> = {},
  ) {
    const cfg = { ...DEFAULT_CFG, ...reminderConfig };
    const sendTransactional = jest.fn().mockResolvedValue(undefined);
    const email = { sendTransactional } as unknown as EmailClient;
    const mustShip = jest.fn().mockResolvedValue(summary);
    const fulfillment = { mustShip } as unknown as FulfillmentService;
    const prisma = {
      platformAdmin: {
        findMany: jest.fn().mockResolvedValue(adminEmails.map((e) => ({ email: e }))),
      },
    } as unknown as PrismaService;
    const notifyAllAdmins = jest.fn().mockResolvedValue(true);
    const platformNotifications = { notifyAllAdmins } as unknown as PlatformNotificationService;
    const getReminderConfig = jest.fn().mockResolvedValue(cfg);
    const dispatchConfig = { getReminderConfig } as unknown as DispatchConfigService;
    const service = new DispatchReminderService(
      envConfig,
      fulfillment,
      platformNotifications,
      dispatchConfig,
      prisma,
      email,
    );
    return { service, sendTransactional, notifyAllAdmins, mustShip, getReminderConfig };
  }

  const emptySummary: MustShipSummary = { overdue: 0, today: 0, dueSoon: 0, total: 0, cards: [] };

  const busySummary: MustShipSummary = {
    overdue: 2,
    today: 1,
    dueSoon: 3,
    total: 6,
    cards: [
      {
        jobId: "job-1",
        orderNumber: 1042,
        recipientName: "Ada Lovelace",
        city: "London",
        postcode: "SW1A 1AA",
        dueDate: new Date("2026-08-01T00:00:00.000Z"),
        workingDaysUntilDue: -3,
        status: "printed",
      },
    ],
  };

  it("sends nothing (email or in-app) when the board is clear", async () => {
    const { service, sendTransactional, notifyAllAdmins } = build(emptySummary, ["ops@kudos.test"]);
    const result = await service.runDispatchReminder();
    expect(result.adminsEmailed).toBe(0);
    expect(sendTransactional).not.toHaveBeenCalled();
    expect(notifyAllAdmins).not.toHaveBeenCalled();
  });

  it("emails each distinct admin once, overdue-led, and writes one in-app entry", async () => {
    const { service, sendTransactional, notifyAllAdmins } = build(busySummary, [
      "ops@kudos.test",
      "OPS@kudos.test", // same address, different case — deduped
      "boss@kudos.test",
      null, // no email — skipped
    ]);

    const result = await service.runDispatchReminder();

    expect(result).toMatchObject({
      adminsEmailed: 2,
      overdue: 2,
      today: 1,
      dueSoon: 3,
      escalated: false,
    });
    expect(sendTransactional).toHaveBeenCalledTimes(2);
    const [firstArgs] = sendTransactional.mock.calls as { subject: string; html: string }[][];
    const call = firstArgs![0]!;
    expect(call.subject).toContain("overdue");
    expect(call.subject).toContain("2");
    expect(call.html).toContain("Ada Lovelace");
    expect(call.html).toContain("ORD-1042");
    // The in-app notification centre entry is written once, keyed by today's date.
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1);
    const [notifyArgs] = notifyAllAdmins.mock.calls as { kind: string; entityId: string }[][];
    const notify = notifyArgs![0]!;
    expect(notify.kind).toBe("dispatch_reminder");
    expect(notify.entityId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not re-email when today's entry already exists (first run wins)", async () => {
    const { service, sendTransactional, notifyAllAdmins } = build(busySummary, ["ops@kudos.test"]);
    // Another instance already recorded today's entry → notify returns false.
    notifyAllAdmins.mockResolvedValueOnce(false);
    const result = await service.runDispatchReminder();
    expect(result.adminsEmailed).toBe(0);
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it("still writes the in-app entry (and doesn't throw) when no admin has an email", async () => {
    const { service, sendTransactional, notifyAllAdmins } = build(busySummary, [null, null]);
    const result = await service.runDispatchReminder();
    expect(result.adminsEmailed).toBe(0);
    expect(sendTransactional).not.toHaveBeenCalled();
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1);
  });

  it("escalates critically-overdue cards to super admins", async () => {
    const { service, notifyAllAdmins } = build(busySummary, ["boss@kudos.test"], {
      escalateAfterWorkingDays: 3, // the -3wd card is exactly critical
    });

    const result = await service.runDispatchReminder();

    expect(result.critical).toBe(1);
    expect(result.escalated).toBe(true);
    // Two notifications: the digest, then a super-admin-scoped escalation.
    expect(notifyAllAdmins).toHaveBeenCalledTimes(2);
    const calls = notifyAllAdmins.mock.calls as [{ kind: string }, { role?: string }][];
    const escalation = calls[1]!;
    expect(escalation[0].kind).toBe("dispatch_escalation");
    expect(escalation[1]?.role).toBe("super_admin");
  });

  it("the cron gate skips the run when disabled", async () => {
    const { service, mustShip } = build(busySummary, ["ops@kudos.test"], { enabled: false });
    await service.scheduledReminder();
    expect(mustShip).not.toHaveBeenCalled();
  });

  it("the cron gate skips the run outside the configured send hour", async () => {
    const otherHour = (new Date().getUTCHours() + 1) % 24;
    const { service, mustShip } = build(busySummary, ["ops@kudos.test"], {
      sendHourUtc: otherHour,
    });
    await service.scheduledReminder();
    expect(mustShip).not.toHaveBeenCalled();
  });
});
