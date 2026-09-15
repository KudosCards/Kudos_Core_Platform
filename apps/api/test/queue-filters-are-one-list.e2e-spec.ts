import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { DUE_FILTERS, HELD_FILTERS, QUEUE_SORTS } from "@kudos/shared-types";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The queue's filter values were declared twice — once in `shared-types`, where
 * the ops UI reads them to draw the chips, and once in the API's query DTO,
 * where the validator decides what it will accept. Two lists that happened to
 * agree.
 *
 * They are one list now, but a future edit can always re-add a local copy. This
 * asserts the property that actually matters: every value the UI can offer is a
 * value the endpoint accepts. A chip that 400s is a chip nobody can use.
 *
 * See docs/returned-address-hold-plan.md, phase 4.
 */
describe("Queue filters — the UI's list and the validator's list (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ops: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role: "super_admin" } });
    ops = await mintToken(userId);
  });

  afterAll(async () => {
    await app.close();
  });

  const queue = (query: string) =>
    request(app.getHttpServer())
      .get(`/fulfillment/jobs?${query}`)
      .set("Authorization", `Bearer ${ops}`);

  it.each(DUE_FILTERS)("accepts the deadline filter the chips offer: %s", async (due) => {
    await queue(`due=${due}`).expect(200);
  });

  it.each(HELD_FILTERS)("accepts the held view the chips offer: %s", async (held) => {
    await queue(`held=${held}`).expect(200);
  });

  it.each(QUEUE_SORTS)("accepts the sort the queue can ask for: %s", async (sort) => {
    await queue(`sort=${sort}`).expect(200);
  });

  it("still refuses a value no list contains", async () => {
    // The discriminator: a validator that accepted anything would pass every
    // test above while checking nothing.
    await queue("due=whenever").expect(400);
    await queue("held=maybe").expect(400);
    await queue("sort=alphabetical").expect(400);
  });
});
