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
    // The two duplicates were still in the future, so they are gone rather than
    // marked `missed`: "the date passed and no card was sent" would be a plain
    // falsehood on a date that has not passed.
    const rows = await birthdays(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("approved");
    expect(iso(rows[0]!.occasionDate)).toBe(iso(dayFromNow(70)));
  });

  it("marks a duplicate whose date has been as missed, and only that one", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));
    const first = await prisma.occasion.findFirstOrThrow({ where: { recipientId: id } });
    await prisma.occasion.update({ where: { id: first.id }, data: { status: "approved" } });

    // One stale row behind us, one still ahead. They end differently because
    // only one of them describes something that actually happened.
    for (const days of [-15, 12]) {
      await prisma.occasion.create({
        data: {
          accountId: first.accountId,
          recipientId: id,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate: dayFromNow(days),
          dispatchDate: dayFromNow(days),
          status: "pending_approval",
        },
      });
    }

    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: dobFalling(70) })
      .expect(200);

    const rows = await birthdays(id);
    expect(rows.filter((r) => r.status === "missed").map((r) => iso(r.occasionDate))).toEqual([
      iso(dayFromNow(-15)),
    ]);
    // The future duplicate is gone, not relabelled.
    expect(rows.map((r) => iso(r.occasionDate))).not.toContain(iso(dayFromNow(12)));
    const live = rows.filter((r) => r.status === "approved");
    expect(live).toHaveLength(1);
    expect(iso(live[0]!.occasionDate)).toBe(iso(dayFromNow(70)));
  });

  /**
   * Only one row may hold a given (recipient, type, date). The realign moves the
   * live birthday onto the corrected date — but it only ever *looked* at live
   * rows, and a `skipped`, `missed` or already-ordered birthday can be sitting
   * on that very date. The move then hits the unique key.
   *
   * This is not a corner: a contact who skipped a birthday last month, or whose
   * past date was retired as `missed`, is carrying exactly such a row. See ADR
   * 0185.
   */
  describe("correcting onto a date another birthday already holds", () => {
    /** A contact with a live birthday on one date and a closed one on another. */
    async function contactWithClosedBirthdayOn(
      token: string,
      closedStatus: "skipped" | "missed" | "queued",
      closedDaysAhead: number,
    ): Promise<{ id: string; closedDate: Date }> {
      const id = await addContact(token, dobFalling(5));
      const closedDate = dayFromNow(closedDaysAhead);
      closedDate.setUTCHours(0, 0, 0, 0);
      const account = await prisma.recipient.findUniqueOrThrow({ where: { id } });
      await prisma.occasion.create({
        data: {
          accountId: account.accountId,
          recipientId: id,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate: closedDate,
          status: closedStatus,
        },
      });
      return { id, closedDate };
    }

    it("does not 500 when a skipped birthday already holds the corrected date", async () => {
      const token = await signUp();
      const { id } = await contactWithClosedBirthdayOn(token, "skipped", 40);

      await request(app.getHttpServer())
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ dateOfBirth: dobFalling(40) })
        .expect(200);
    });

    it("respects a skip the customer already made on that date", async () => {
      // The customer said "no card for this date". Correcting the date of birth
      // onto it does not undo that: the date is already represented, so the live
      // row is surplus and gives way rather than resurrecting a send that was
      // declined. What must NOT survive is a live birthday on the old, wrong
      // date — that is the actual harm.
      const token = await signUp();
      const { id } = await contactWithClosedBirthdayOn(token, "skipped", 40);

      await request(app.getHttpServer())
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ dateOfBirth: dobFalling(40) })
        .expect(200);

      const rows = await birthdays(id);
      const skipped = rows.filter((r) => r.status === "skipped");
      expect(skipped).toHaveLength(1);
      expect(iso(skipped[0]!.occasionDate)).toBe(iso(dayFromNow(40)));

      // No live row left stranded on the old date. Unskipping is one click away
      // if the customer does want the card after all.
      const liveOnWrongDate = rows.filter(
        (r) =>
          !["skipped", "missed"].includes(r.status) && iso(r.occasionDate) !== iso(dayFromNow(40)),
      );
      expect(liveOnWrongDate).toHaveLength(0);
    });

    it("does not 500 when the date is held by a card already in production", async () => {
      // The committed row must stay exactly where it is — the money is spent —
      // so the live birthday cannot take that date and has to give way instead.
      const token = await signUp();
      const { id } = await contactWithClosedBirthdayOn(token, "queued", 40);

      await request(app.getHttpServer())
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ dateOfBirth: dobFalling(40) })
        .expect(200);

      const rows = await birthdays(id);
      // The queued card is untouched.
      expect(rows.filter((r) => r.status === "queued")).toHaveLength(1);
      // And the contact is not left with a live birthday on the wrong date.
      const stale = rows.filter(
        (r) =>
          !["skipped", "missed", "queued"].includes(r.status) &&
          iso(r.occasionDate) !== iso(dayFromNow(40)),
      );
      expect(stale).toHaveLength(0);
    });

    it("does not destroy the contact's other birthdays on the way to failing", async () => {
      // The realign retires the losing rows *before* it moves the keeper, and
      // none of it is in a transaction. A throw at the move therefore committed
      // the destruction and left the keeper on the old date — a correction that
      // makes things worse and fails identically on every retry.
      const token = await signUp();
      const { id } = await contactWithClosedBirthdayOn(token, "missed", 40);
      const before = await birthdays(id);

      await request(app.getHttpServer())
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ dateOfBirth: dobFalling(40) })
        .expect(200);

      const after = await birthdays(id);
      expect(after.length).toBeGreaterThanOrEqual(before.length - 1);
      // Whatever else happened, the contact has a birthday on the right date.
      expect(after.map((r) => iso(r.occasionDate))).toContain(iso(dayFromNow(40)));
    });
  });

  it("refuses a date of birth nobody could have been born on", async () => {
    const token = await signUp();
    const body = (dateOfBirth: string) => ({
      firstName: "Frank",
      lastName: randomUUID().slice(0, 8),
      dateOfBirth,
      addressLine1: "33 Helen's Wood Crescent",
      addressCity: "Bangor",
      addressPostcode: "BT19 1FE",
    });

    // The bound is what is *impossible*, not what is unusual. A live account
    // held a contact recorded as born three weeks ago — almost certainly a
    // mistyped year, and the app duly read it as a birthday and scheduled a
    // card. But a date three weeks ago is a date someone could be born on, so
    // it is not the API's to refuse; what it can refuse is a date that has not
    // happened yet, which is what that entry was when it was typed.
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(body(iso(dayFromNow(-20))))
      .expect(201);
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(body(iso(dayFromNow(30))))
      .expect(400);
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(body("1850-01-01"))
      .expect(400);

    // And a real one still goes through, on create and on update alike.
    const ok = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(body("1996-10-23"))
      .expect(201);
    const id = (ok.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: iso(dayFromNow(10)) })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/recipients/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "1995-07-13" })
      .expect(200);
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

  it("retires a shared event's occasions too, not just a hand-added one", async () => {
    const token = await signUp();
    const members = [await addContact(token, null), await addContact(token, null)];
    await request(app.getHttpServer())
      .post("/events")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Results Day",
        type: "achievement",
        eventDate: iso(dayFromNow(-4)),
        recipientIds: members,
      })
      .expect(201);

    const summary = await scheduler.scheduleBirthdayOccasions();
    expect(summary.missedEvents).toBeGreaterThanOrEqual(2);

    // A cohort nobody ordered for is exactly the case the sweep exists for: no
    // timer promotes a shared event, so its date passing is terminal. Left
    // `scheduled`, all forty members read "Scheduled" on the calendar a year
    // later, each with a "Prepare card" button that only throws.
    const occasions = await prisma.occasion.findMany({
      where: { recipientId: { in: members }, source: "shared_event" },
    });
    expect(occasions).toHaveLength(2);
    expect(occasions.map((o) => o.status)).toEqual(["missed", "missed"]);
  });

  it("leaves a past-dated scheduled birthday alone — the scheduler rolls those", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));
    const occasion = await prisma.occasion.findFirstOrThrow({ where: { recipientId: id } });
    // A recurring occasion that is past and still `scheduled` is a transient
    // state between the date passing and the next run rolling it forward — not
    // a dead row. Sweeping it would put "missed" on the calendar for a date the
    // scheduler is about to replace. Only the sources nothing ever moves are
    // retired, which is why the filter is expressed as an exclusion.
    await prisma.occasion.update({
      where: { id: occasion.id },
      data: { status: "scheduled", occasionDate: dayFromNow(-30), dispatchDate: dayFromNow(-35) },
    });

    await scheduler.scheduleBirthdayOccasions();

    const after = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    expect(after.status).toBe("scheduled");
  });

  it("leaves an approval dated today alone — sending late is the customer's call", async () => {
    const token = await signUp();
    const id = await addContact(token, dobFalling(5));
    const occasion = await prisma.occasion.findFirstOrThrow({ where: { recipientId: id } });
    await prisma.occasion.update({
      where: { id: occasion.id },
      data: { status: "approved", occasionDate: dayFromNow(0), dispatchDate: dayFromNow(-5) },
    });

    await scheduler.scheduleBirthdayOccasions();

    // Strictly before today, not on or before. It is too late for the card to
    // arrive on the day, but whether to send it anyway belongs to the customer
    // — retiring it takes the choice away without asking.
    const after = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    expect(after.status).toBe("approved");
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
