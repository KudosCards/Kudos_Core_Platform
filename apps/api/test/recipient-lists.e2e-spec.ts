import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  recipientListSummarySchema,
  recipientListWithMembersSchema,
} from "@kudos/shared-types";
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
      .send({ firstName, lastName: "Pupil" })
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
    const detail = recipientListWithMembersSchema.parse(withMembers.body);
    expect(detail.memberCount).toBe(2);
    expect(detail.members.map((m) => m.id).sort()).toEqual([alice, bob].sort());

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
    expect(recipientListWithMembersSchema.parse(again.body).memberCount).toBe(2);

    await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}/members/${alice}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const afterRemoval = await request(app.getHttpServer())
      .get(`/recipient-lists/${listId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(recipientListWithMembersSchema.parse(afterRemoval.body).memberCount).toBe(1);
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
