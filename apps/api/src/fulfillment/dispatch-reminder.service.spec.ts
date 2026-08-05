import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { EmailClient } from "../email/email.client";
import type { EnvConfig } from "../config/env.schema";
import { DispatchReminderService } from "./dispatch-reminder.service";
import type { FulfillmentService, MustShipSummary } from "./fulfillment.service";

/**
 * The send-by-5 reminder, unit-tested against a mocked must-ship query, admin
 * list and email client — no DB. Proves: suppress-when-empty, one send per
 * distinct admin email, overdue-led subject, and the graceful no-recipients case.
 */
describe("DispatchReminderService", () => {
  const config = {
    get: () => "https://app.kudos.test",
  } as unknown as ConfigService<EnvConfig, true>;

  function build(summary: MustShipSummary, adminEmails: (string | null)[]) {
    const sendTransactional = jest.fn().mockResolvedValue(undefined);
    const email = { sendTransactional } as unknown as EmailClient;
    const fulfillment = {
      mustShip: jest.fn().mockResolvedValue(summary),
    } as unknown as FulfillmentService;
    const prisma = {
      platformAdmin: {
        findMany: jest.fn().mockResolvedValue(adminEmails.map((e) => ({ email: e }))),
      },
    } as unknown as PrismaService;
    const service = new DispatchReminderService(prisma, config, fulfillment, email);
    return { service, sendTransactional };
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

  it("sends nothing when the board is clear", async () => {
    const { service, sendTransactional } = build(emptySummary, ["ops@kudos.test"]);
    const result = await service.runDispatchReminder();
    expect(result.adminsEmailed).toBe(0);
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it("emails each distinct admin once, overdue-led, listing the cards", async () => {
    const { service, sendTransactional } = build(busySummary, [
      "ops@kudos.test",
      "OPS@kudos.test", // same address, different case — deduped
      "boss@kudos.test",
      null, // no email — skipped
    ]);

    const result = await service.runDispatchReminder();

    expect(result).toMatchObject({ adminsEmailed: 2, overdue: 2, today: 1, dueSoon: 3 });
    expect(sendTransactional).toHaveBeenCalledTimes(2);
    const [firstArgs] = sendTransactional.mock.calls as { subject: string; html: string }[][];
    const call = firstArgs![0]!;
    expect(call.subject).toContain("overdue");
    expect(call.subject).toContain("2");
    expect(call.html).toContain("Ada Lovelace");
    expect(call.html).toContain("ORD-1042");
  });

  it("does not send (and does not throw) when no admin has an email", async () => {
    const { service, sendTransactional } = build(busySummary, [null, null]);
    const result = await service.runDispatchReminder();
    expect(result.adminsEmailed).toBe(0);
    expect(sendTransactional).not.toHaveBeenCalled();
  });
});
