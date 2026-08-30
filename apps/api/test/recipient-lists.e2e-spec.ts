import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { recipientListSummarySchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Recipient lists (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return token;
  }

  async function createRecipient(token: string, firstName: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName,
        lastName: "Pupil",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createList(token: string, name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipient-lists")
      .set("Authorization", `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return recipientListSummarySchema.parse(response.body).id;
  }

  it("creates, lists, renames and deletes a list", async () => {
    const token = await signUp();
    const id = await createList(token, "Year 4 class");

    const listed = await request(app.getHttpServer())
      .get("/recipient-lists")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const lists = z.array(recipientListSummarySchema).parse(listed.body);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ id, name: "Year 4 class", memberCount: 0 });

    const renamed = await request(app.getHttpServer())
      .patch(`/recipient-lists/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Year 5 class" })
      .expect(200);
    expect(recipientListSummarySchema.parse(renamed.body).name).toBe("Year 5 class");

    await request(app.getHttpServer())
      .delete(`/recipient-lists/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const afterDelete = await request(app.getHttpServer())
      .get("/recipient-lists")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(afterDelete.body).toHaveLength(0);
  });

  it("rejects a duplicate list name within the same account", async () => {
    const token = await signUp();
    await createList(token, "Year 6 class");
    await request(app.getHttpServer())
      .post("/recipient-lists")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Year 6 class" })
      .expect(409);
  });

  it("accepts more ids than the largest capped plan allows contacts", async () => {
    // The bound was 1,000, commented as "well above any plan's recipient cap".
    // Centre's cap is 2,000 and Enterprise has none, so a Centre account that
    // ticked all its contacts and pressed "Add to list" got a 400 for doing
    // exactly what the button offers. The ids here are unknown to the account,
    // so nothing is added — this is about the request being accepted at all.
    const token = await signUp();
    const listId = await createList(token, "Everyone");
    // Two real contacts, padded out past the old bound. The padding stands in
    // for the rest of a large account's book without the cost of creating it.
    const real = [await createRecipient(token, "Alice"), await createRecipient(token, "Bob")];
    const ids = [...real, ...Array.from({ length: 1_498 }, () => randomUUID())];

    const response = await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: ids })
      .expect(201);

    expect(recipientListSummarySchema.parse(response.body).memberCount).toBe(2);
  });

  it("adds and removes members, and filters recipients by list", async () => {
    const token = await signUp();
    const listId = await createList(token, "Reading group");
    const alice = await createRecipient(token, "Alice");
    const bob = await createRecipient(token, "Bob");
    await createRecipient(token, "Carol"); // not on the list

    const withMembers = await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [alice, bob] })
      .expect(201);
    const detail = recipientListSummarySchema.parse(withMembers.body);
    expect(detail.memberCount).toBe(2);
    expect(detail.sample.map((m) => m.id).sort()).toEqual([alice, bob].sort());

    // Filtering the recipients list by listId returns only its members.
    const filtered = await request(app.getHttpServer())
      .get(`/recipients?listId=${listId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((filtered.body as { total: number }).total).toBe(2);

    // Adding the same recipient again is idempotent (no duplicate membership).
    const again = await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [alice] })
      .expect(201);
    expect(recipientListSummarySchema.parse(again.body).memberCount).toBe(2);

    await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}/members/${alice}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const afterRemoval = await request(app.getHttpServer())
      .get(`/recipient-lists/${listId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(recipientListSummarySchema.parse(afterRemoval.body).memberCount).toBe(1);
  });

  it("caps the inline member preview but keeps the true count", async () => {
    const token = await signUp();
    const listId = await createList(token, "Whole school");
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await createRecipient(token, `Pupil${i}`));

    const added = await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: ids })
      .expect(201);

    // The whole membership is read through /recipients?listId= — the list route
    // carries a preview only, so a five-thousand-contact list stays cheap.
    const summary = recipientListSummarySchema.parse(added.body);
    expect(summary.memberCount).toBe(10);
    expect(summary.sample).toHaveLength(8);
  });

  it("removes several members at once, and is indifferent to ids already off the list", async () => {
    const token = await signUp();
    const listId = await createList(token, "Reading group B");
    const alice = await createRecipient(token, "Alice");
    const bob = await createRecipient(token, "Bob");
    const carol = await createRecipient(token, "Carol");

    await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [alice, bob, carol] })
      .expect(201);

    // Carol is asked for twice over two calls. The second is a no-op rather
    // than a 404: the caller ticked rows on a view that may have moved on, and
    // the outcome it asked for is true either way.
    const first = await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [alice, carol] })
      .expect(200);
    expect(recipientListSummarySchema.parse(first.body).memberCount).toBe(1);

    const second = await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [carol] })
      .expect(200);
    expect(recipientListSummarySchema.parse(second.body).memberCount).toBe(1);
  });

  it("won't bulk-remove members of another account's list", async () => {
    const accountA = await signUp();
    const accountB = await signUp();
    const listId = await createList(accountA, "A's reading group");
    const alice = await createRecipient(accountA, "Alice");
    await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${accountA}`)
      .send({ recipientIds: [alice] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${accountB}`)
      .send({ recipientIds: [alice] })
      .expect(404);
  });

  it("won't attach a recipient that belongs to another account", async () => {
    const accountA = await signUp();
    const accountB = await signUp();
    const listId = await createList(accountA, "A's list");
    const foreignRecipient = await createRecipient(accountB, "Foreign");

    // None of the ids belong to account A, so the add is rejected outright.
    await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${accountA}`)
      .send({ recipientIds: [foreignRecipient] })
      .expect(400);
  });

  it("scopes lists to the account — one account cannot see or touch another's list", async () => {
    const accountA = await signUp();
    const accountB = await signUp();
    const listId = await createList(accountA, "Private list");

    await request(app.getHttpServer())
      .get(`/recipient-lists/${listId}`)
      .set("Authorization", `Bearer ${accountB}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}`)
      .set("Authorization", `Bearer ${accountB}`)
      .expect(404);
  });
});
