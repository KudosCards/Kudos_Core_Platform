import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { OccasionSchedulerService } from "../src/occasions/occasion-scheduler.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * What happens to a contact's dates when the world moves on: a corrected date
 * of birth, and a date that has been and gone.
 *
 * Both were reported from one real contact who ended up with three birthdays —
 * approved on 24 July, awaiting approval on 9 August, and correct on 23 October
 * — after four corrections to a single date of birth. See docs/adr/0178.
 */
describe("Occasion lifecycle (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: OccasionSchedulerService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(OccasionSchedulerService);
  });
  afterAll(async () => await app.close());

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const dayFromNow = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };
  /** A date of birth whose birthday falls `days` from today. */
  const dobFalling = (days: number) => {
    const d = dayFromNow(days);
    return `1996-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Lifecycle ${randomUUID()}` })
      .expect(201);
    return token;
  }

  async function addContact(token: string, dateOfBirth: string | null): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Andy",
        lastName: randomUUID().slice(0, 8),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        addressLine1: "High Fewstergill Farm",
        addressCity: "Darlington",
        addressPostcode: "DL11 7BL",
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const birthdays = (recipientId: string) =>
    prisma.occasion.findMany({
      where: { recipientId, type: "birthday" },
      orderBy: { occasionDate: "asc" },
      select: { id: true, occasionDate: true, status: true, savedDesignId: true },
    });

  it("moves an approved birthday onto the corrected date instead of orphaning it", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));

    const pending = await prisma.occasion.findFirstOrThrow({
      where: { recipientId: id, status: "pending_approval" },
    });
    await prisma.occasion.update({ where: { id: pending.id }, data: { status: "approved" } });

    const corrected = dobFalling(60);
    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: corrected })
      .expect(200);

    // One birthday, on the corrected date, still approved. Before this the old
    // date survived as a second approved row and the contact had two birthdays.
    const rows = await birthdays(id);
    expect(rows).toHaveLength(1);
    expect(iso(rows[0]!.occasionDate)).toBe(iso(dayFromNow(60)));
    expect(rows[0]!.status).toBe("approved");
  });

  it("keeps the chosen design across a correction — a typo is not a change of mind", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));
    const occasion = await prisma.occasion.findFirstOrThrow({
      where: { recipientId: id, status: "pending_approval" },
    });
    const design = await prisma.savedDesign.create({
      data: {
        accountId: occasion.accountId,
        name: "Balloons",
        document: {},
      },
    });
    await prisma.occasion.update({
      where: { id: occasion.id },
      data: { status: "approved", savedDesignId: design.id },
    });

    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: dobFalling(40) })
      .expect(200);

    const rows = await birthdays(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.savedDesignId).toBe(design.id);
  });

  it("never moves a card that is already paid for and in production", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));
    const occasion = await prisma.occasion.findFirstOrThrow({
      where: { recipientId: id, status: "pending_approval" },
    });
    const originalDate = occasion.occasionDate;
    await prisma.occasion.update({ where: { id: occasion.id }, data: { status: "queued" } });

    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: dobFalling(50) })
      .expect(200);

    const rows = await birthdays(id);
    // The ordered card stays exactly where it is — the money is spent and it is
    // part of an order's history — and the corrected date gets its own row.
    expect(rows).toHaveLength(2);
    const queued = rows.find((r) => r.status === "queued");
    expect(queued).toBeDefined();
    expect(iso(queued!.occasionDate)).toBe(iso(originalDate));
    expect(rows.find((r) => r.status === "scheduled")).toBeDefined();
  });

  it("converges a contact that already carries several stale birthdays", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));
    const first = await prisma.occasion.findFirstOrThrow({ where: { recipientId: id } });

    // The reported shape: three live birthdays across earlier corrections.
    await prisma.occasion.update({ where: { id: first.id }, data: { status: "approved" } });
    for (const [days, status] of [
      [12, "pending_approval"],
      [19, "scheduled"],
    ] as const) {
      await prisma.occasion.create({
        data: {
          accountId: first.accountId,
          recipientId: id,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate: dayFromNow(days),
          dispatchDate: dayFromNow(days),
          status,
        },
      });
    }
    expect(await birthdays(id)).toHaveLength(3);

    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: dobFalling(70) })
      .expect(200);

    // One birthday left, on the right date, and it is the approved one — the
    // furthest-along row wins, so an approval with a design is not thrown away.
    const rows = await birthdays(id);
    const live = rows.filter((r) => r.status !== "missed");
    expect(live).toHaveLength(1);
    expect(live[0]!.status).toBe("approved");
    expect(iso(live[0]!.occasionDate)).toBe(iso(dayFromNow(70)));
    expect(rows.filter((r) => r.status === "missed")).toHaveLength(2);
  });

  it("records what the date of birth changed from and to", async () => {
    const token = await signUp();
    const before = dobFalling(5);
    const id = await addContact(token, before);
    const after = dobFalling(90);

    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: after })
      .expect(200);

    // The trail used to record `metadata: null`, so it could show that a date of
    // birth had been edited four times and not what any of the four values were.
    const entry = await prisma.auditLogEntry.findFirstOrThrow({
      where: { targetType: "Recipient", targetId: id, action: "update" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.metadata).toMatchObject({ dateOfBirth: { from: before, to: after } });
  });

  it("retires a past approval as missed, not as something the customer skipped", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));
    const occasion = await prisma.occasion.findFirstOrThrow({ where: { recipientId: id } });
    await prisma.occasion.update({
      where: { id: occasion.id },
      data: { status: "approved", occasionDate: dayFromNow(-20), dispatchDate: dayFromNow(-20) },
    });

    await scheduler.scheduleBirthdayOccasions();

    const after = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    // "Skipped" would be an accusation: nobody chose this.
    expect(after.status).toBe("missed");
  });

  it("retires a hand-added event whose day has passed", async () => {
    const token = await signUp();
    const id = await addContact(token, null);
    const created = await request(app.getHttpServer())
      .post("/occasions/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientId: id, type: "leaver", title: "96", occasionDate: iso(dayFromNow(-4)) })
      .expect(201);
    const eventId = (created.body as { id: string }).id;

    const summary = await scheduler.scheduleBirthdayOccasions();
    expect(summary.missedEvents).toBeGreaterThanOrEqual(1);

    const after = await prisma.occasion.findUniqueOrThrow({ where: { id: eventId } });
    // Nothing ever promotes a one-off, so its date passing is terminal. It used
    // to sit "Scheduled" for ever with a live "Prepare card" button.
    expect(after.status).toBe("missed");
  });

  it("won't prepare a card for a date that has already passed", async () => {
    const token = await signUp();
    const id = await addContact(token, null);
    const created = await request(app.getHttpServer())
      .post("/occasions/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientId: id, type: "achievement", occasionDate: iso(dayFromNow(-2)) })
      .expect(201);
    const eventId = (created.body as { id: string }).id;

    // Without the bound this moved into Approvals and the next nightly sweep
    // immediately retired it — a round trip that looked like it had done
    // something and had not.
    const res = await request(app.getHttpServer())
      .post(`/occasions/${eventId}/prepare`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    expect(JSON.stringify(res.body)).toMatch(/already passed/i);
  });

  it("still prepares a card for a date still to come", async () => {
    const token = await signUp();
    const id = await addContact(token, null);
    const created = await request(app.getHttpServer())
      .post("/occasions/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientId: id, type: "achievement", occasionDate: iso(dayFromNow(10)) })
      .expect(201);
    const eventId = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/occasions/${eventId}/prepare`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const after = await prisma.occasion.findUniqueOrThrow({ where: { id: eventId } });
    expect(after.status).toBe("pending_approval");
  });
});
