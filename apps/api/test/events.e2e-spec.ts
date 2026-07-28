import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

interface EventBody {
  id: string;
  title: string;
  type: string;
  memberCount: number;
  sentCount: number;
  members: { occasionId: string; recipientId: string; status: string }[];
}

describe("Events (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  async function createRecipient(token: string, first: string, withAddress = true): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: first,
        lastName: "Pupil",
        ...(withAddress && {
          addressLine1: "1 Test Street",
          addressCity: "London",
          addressPostcode: "SW1A 1AA",
        }),
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createSavedDesign(token: string): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Event card" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it("creates a shared event with a cohort, then adds and removes members", async () => {
    const { token } = await signUp();
    const a = await createRecipient(token, "Ada");
    const b = await createRecipient(token, "Bea");
    const c = await createRecipient(token, "Cal");

    const created = await request(app.getHttpServer())
      .post("/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "End of Year", type: "leaver", eventDate: "2026-07-17", recipientIds: [a, b] })
      .expect(201);
    const event = created.body as EventBody;
    expect(event.memberCount).toBe(2);
    expect(event.sentCount).toBe(0);
    expect(event.members.every((m) => m.status === "scheduled")).toBe(true);

    // The member occasions carry the shared-event source + the event title.
    const occasions = await prisma.occasion.findMany({ where: { eventId: event.id } });
    expect(occasions).toHaveLength(2);
    expect(occasions.every((o) => o.source === "shared_event" && o.title === "End of Year")).toBe(true);

    // It appears in the account's event list (date-ranged for the calendar).
    const listed = await request(app.getHttpServer())
      .get("/events?from=2026-07-01&to=2026-07-31")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((listed.body as EventBody[]).map((e) => e.id)).toContain(event.id);

    const added = await request(app.getHttpServer())
      .post(`/events/${event.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [c] })
      .expect(201);
    expect((added.body as EventBody).memberCount).toBe(3);

    await request(app.getHttpServer())
      .delete(`/events/${event.id}/members/${c}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const afterRemove = await request(app.getHttpServer())
      .get(`/events/${event.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((afterRemove.body as EventBody).memberCount).toBe(2);
  });

  it("re-dates member occasions when the event date changes", async () => {
    const { token } = await signUp();
    const a = await createRecipient(token, "Dot");
    const created = await request(app.getHttpServer())
      .post("/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "SATs", type: "achievement", eventDate: "2026-05-11", recipientIds: [a] })
      .expect(201);
    const event = created.body as EventBody;

    await request(app.getHttpServer())
      .patch(`/events/${event.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ eventDate: "2026-06-15", title: "SATs week" })
      .expect(200);

    const occasion = await prisma.occasion.findFirstOrThrow({ where: { eventId: event.id } });
    expect(occasion.occasionDate.toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(occasion.title).toBe("SATs week");
  });

  it("orders the whole cohort into one draft order, then blocks deletion", async () => {
    const { token } = await signUp();
    const a = await createRecipient(token, "Eve");
    const b = await createRecipient(token, "Fay");
    const designId = await createSavedDesign(token);

    const created = await request(app.getHttpServer())
      .post("/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Results Day", type: "achievement", eventDate: "2026-08-20", recipientIds: [a, b] })
      .expect(201);
    const eventId = (created.body as EventBody).id;

    const order = await request(app.getHttpServer())
      .post(`/events/${eventId}/order`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId: designId, postageClass: "second_class" })
      .expect(201);
    const body = order.body as { status: string; orderRecipients: unknown[] };
    expect(body.status).toBe("draft");
    expect(body.orderRecipients).toHaveLength(2);

    // Members are consumed into the order (queued), so the event can't be deleted.
    const afterOrder = await request(app.getHttpServer())
      .get(`/events/${eventId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((afterOrder.body as EventBody).sentCount).toBe(2);

    await request(app.getHttpServer())
      .delete(`/events/${eventId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
  });

  it("refuses to order when a contact has no postal address", async () => {
    const { token } = await signUp();
    const a = await createRecipient(token, "Gus", false);
    const designId = await createSavedDesign(token);
    const created = await request(app.getHttpServer())
      .post("/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Prize Day", type: "achievement", eventDate: "2026-09-10", recipientIds: [a] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/events/${(created.body as EventBody).id}/order`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId: designId })
      .expect(400);
  });

  it("does not leak another account's event", async () => {
    const owner = await signUp();
    const a = await createRecipient(owner.token, "Hal");
    const created = await request(app.getHttpServer())
      .post("/events")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Private", type: "seasonal", eventDate: "2026-12-10", recipientIds: [a] })
      .expect(201);

    const stranger = await signUp();
    await request(app.getHttpServer())
      .get(`/events/${(created.body as EventBody).id}`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .expect(404);
  });
});
