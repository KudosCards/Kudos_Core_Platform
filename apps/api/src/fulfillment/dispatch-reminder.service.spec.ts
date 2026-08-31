import type { ConfigService } from "@nestjs/config";
import { londonHour, type DispatchReminderConfig } from "@kudos/shared-types";
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
    sendHourLondon: 7,
    leadWorkingDays: 5,
    // High by default so escalation is off unless a test opts in.
    escalateAfterWorkingDays: 99,
    sameDayCutoffHour: 15,
  };

  /** An operator row. A bare string is an `ops` operator, so existing cases read
   *  unchanged; pass `{ email, role }` to make someone a super admin. */
  type Operator = string | null | { email: string | null; role: string };

  function build(
    summary: MustShipSummary,
    adminEmails: Operator[],
    reminderConfig: Partial<DispatchReminderConfig> = {},
  ) {
    const cfg = { ...DEFAULT_CFG, ...reminderConfig };
    const sendTransactional = jest.fn().mockResolvedValue(undefined);
    const email = { sendTransactional } as unknown as EmailClient;
    const mustShip = jest.fn().mockResolvedValue(summary);
    const fulfillment = { mustShip } as unknown as FulfillmentService;
    const operators = adminEmails.map((entry) =>
      typeof entry === "object" && entry !== null ? entry : { email: entry, role: "ops" },
    );
    // Applies the role filter the service passes, so a test can tell the digest
    // and the escalation apart by who actually received them.
    const findMany = jest.fn((args: { where?: { role?: string } }) =>
      Promise.resolve(
        operators
          .filter((op) => op.email !== null)
          .filter((op) => !args?.where?.role || op.role === args.where.role)
          .map((op) => ({ email: op.email })),
      ),
    );
    const prisma = { platformAdmin: { findMany } } as unknown as PrismaService;
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
    const { service, notifyAllAdmins } = build(
      busySummary,
      [{ email: "boss@kudos.test", role: "super_admin" }],
      { escalateAfterWorkingDays: 3 }, // the -3wd card is exactly critical
    );

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

  it("emails a super admin once when escalating, not twice", async () => {
    // The bug this closes: the escalation reused the digest's body verbatim, so
    // a super admin got two emails with identical content and different
    // subjects, and the system looked like it was sending everything twice.
    const { service, sendTransactional } = build(
      busySummary,
      [{ email: "boss@kudos.test", role: "super_admin" }],
      { escalateAfterWorkingDays: 3 },
    );

    const result = await service.runDispatchReminder();

    expect(sendTransactional).toHaveBeenCalledTimes(1);
    const [onlyArgs] = sendTransactional.mock.calls as { subject: string; html: string }[][];
    expect(onlyArgs![0]!.subject).toContain("critically overdue");
    expect(result.adminsEmailed).toBe(1);
  });

  it("sends the ops digest and the super-admin escalation to different people", async () => {
    const { service, sendTransactional } = build(
      busySummary,
      [
        { email: "ops@kudos.test", role: "ops" },
        { email: "boss@kudos.test", role: "super_admin" },
      ],
      { escalateAfterWorkingDays: 3 },
    );

    const result = await service.runDispatchReminder();

    expect(sendTransactional).toHaveBeenCalledTimes(2);
    const calls = sendTransactional.mock.calls as { to: string; subject: string; html: string }[][];
    const byRecipient = new Map(calls.map((args) => [args[0]!.to, args[0]!]));
    expect(byRecipient.get("boss@kudos.test")?.subject).toContain("critically overdue");
    expect(byRecipient.get("ops@kudos.test")?.subject).not.toContain("critically overdue");
    // And the bodies differ — the escalation leads with the banner.
    expect(byRecipient.get("boss@kudos.test")?.html).not.toBe(
      byRecipient.get("ops@kudos.test")?.html,
    );
    expect(byRecipient.get("boss@kudos.test")?.html).toContain("overdue by 3+ working days");
    expect(byRecipient.get("ops@kudos.test")?.html).not.toContain("overdue by 3+ working days");
    expect(result.adminsEmailed).toBe(2);
  });

  /**
   * The reminder dedupes on a day key: one entry per day, and whoever writes it
   * first is the one that emails. That key has to be the London day, because
   * this is a London-scheduled job for a UK business — and for the seven months
   * of BST a London day starts at 23:00 the previous day in UTC. See ADR 0211.
   */
  describe("the day the reminder is for", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    /** Every notification payload a run handed to the notification centre. */
    function payloads(spy: jest.Mock): { kind: string; entityId: string }[] {
      return spy.mock.calls.map((call) => (call as [{ kind: string; entityId: string }])[0]);
    }

    /** Freeze the clock at an instant and run the reminder, returning the day
     * key it recorded the run under. */
    async function keyAt(instant: string): Promise<string> {
      jest.useFakeTimers().setSystemTime(new Date(instant));
      const { service, notifyAllAdmins } = build(busySummary, ["ops@kudos.test"]);
      await service.runDispatchReminder();
      return payloads(notifyAllAdmins)[0]!.entityId;
    }

    it("keys on the London day, not the UTC one, during BST", async () => {
      // 23:30 UTC on 15 June is 00:30 on 16 June in London. The run belongs to
      // the 16th — that is the working day whose cards it is chasing.
      expect(await keyAt("2026-06-15T23:30:00.000Z")).toBe("2026-06-16");
    });

    it("keys the same as UTC in winter, when London is GMT", async () => {
      expect(await keyAt("2026-01-15T23:30:00.000Z")).toBe("2026-01-15");
      expect(await keyAt("2026-01-15T07:00:00.000Z")).toBe("2026-01-15");
    });

    it("does not suppress a run because a neighbouring London day shares its UTC date", async () => {
      // The harm, end to end. A reminder late on one London evening and the
      // next morning's are different days to everyone in the UK — but during
      // BST they are the same UTC date, so a UTC key made the second one look
      // like a repeat of the first. `notifyAllAdmins` returns false for a
      // repeat, and the service then emails nobody at all.
      const seen = new Set<string>();
      const runAt = async (instant: string): Promise<boolean> => {
        jest.useFakeTimers().setSystemTime(new Date(instant));
        const { service, sendTransactional, notifyAllAdmins } = build(busySummary, [
          "ops@kudos.test",
        ]);
        // Stand in for the real dedupe: a key already recorded wins.
        notifyAllAdmins.mockImplementation((payload: { entityId: string }) => {
          if (seen.has(payload.entityId)) return Promise.resolve(false);
          seen.add(payload.entityId);
          return Promise.resolve(true);
        });
        await service.runDispatchReminder();
        return sendTransactional.mock.calls.length > 0;
      };

      // London Sunday 23:00 (an on-demand run), then London Monday 00:00.
      expect(await runAt("2026-06-14T22:00:00.000Z")).toBe(true);
      expect(await runAt("2026-06-14T23:00:00.000Z")).toBe(true);
      expect([...seen].sort()).toEqual(["2026-06-14", "2026-06-15"]);
    });

    it("keys the super-admin escalation on the same London day", async () => {
      // The escalation dedupes on its own entityId, so it needs the same day or
      // it goes quiet on exactly the runs the digest does — and this is the
      // louder of the two alerts.
      jest.useFakeTimers().setSystemTime(new Date("2026-06-15T23:30:00.000Z"));
      const { service, notifyAllAdmins } = build(
        busySummary,
        [{ email: "boss@kudos.test", role: "super_admin" }],
        { escalateAfterWorkingDays: 2 },
      );

      const result = await service.runDispatchReminder();

      expect(result.escalated).toBe(true);
      const escalation = payloads(notifyAllAdmins).find(
        (payload) => payload.kind === "dispatch_escalation",
      );
      expect(escalation?.entityId).toBe("2026-06-16");
    });

    it("still suppresses a genuine repeat within the same London day", async () => {
      const seen = new Set<string>();
      const runAt = async (instant: string): Promise<boolean> => {
        jest.useFakeTimers().setSystemTime(new Date(instant));
        const { service, sendTransactional, notifyAllAdmins } = build(busySummary, [
          "ops@kudos.test",
        ]);
        notifyAllAdmins.mockImplementation((payload: { entityId: string }) => {
          if (seen.has(payload.entityId)) return Promise.resolve(false);
          seen.add(payload.entityId);
          return Promise.resolve(true);
        });
        await service.runDispatchReminder();
        return sendTransactional.mock.calls.length > 0;
      };

      expect(await runAt("2026-06-15T06:00:00.000Z")).toBe(true);
      // Two hours later, same London day — the second must stay quiet.
      expect(await runAt("2026-06-15T08:00:00.000Z")).toBe(false);
      expect([...seen]).toEqual(["2026-06-15"]);
    });
  });

  it("the cron gate skips the run when disabled", async () => {
    const { service, mustShip } = build(busySummary, ["ops@kudos.test"], { enabled: false });
    await service.scheduledReminder();
    expect(mustShip).not.toHaveBeenCalled();
  });

  it("the cron gate skips the run outside the configured send hour", async () => {
    // London, not UTC — the two differ for seven months of the year, and using
    // the UTC hour here would make this pass while production ran an hour late.
    const otherHour = (londonHour(new Date()) + 1) % 24;
    const { service, mustShip } = build(busySummary, ["ops@kudos.test"], {
      sendHourLondon: otherHour,
    });
    await service.scheduledReminder();
    expect(mustShip).not.toHaveBeenCalled();
  });

  it("the cron gate runs at the configured London hour", async () => {
    const { service, mustShip } = build(busySummary, ["ops@kudos.test"], {
      sendHourLondon: londonHour(new Date()),
    });
    await service.scheduledReminder();
    expect(mustShip).toHaveBeenCalled();
  });
});
