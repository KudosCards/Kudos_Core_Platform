import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { SERIALIZATION_RETRY_AFTER_SECONDS } from "../src/common/run-serializable";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * A Serializable write that loses the race on every attempt used to reach the
 * client as a 500 — a server fault for what is really "two writes collided, ask
 * again". CI caught it as a flake: five P2034s inside 17ms turned an intended
 * 403 into a 500.
 *
 * Rather than chase the timing, these tests pin the answer. The conflict is
 * injected (rejecting $transaction with P2034) so the assertion is about the
 * response contract, not about winning or losing a race.
 *
 * Filter precedence is the thing that can silently undo this: the Sentry filter
 * is a catch-all, and Nest offers an exception to global filters in reverse
 * registration order, so a specific filter registered too early never runs. That
 * chain now lives in configureApp, which is what createTestApp boots — so this
 * asserts against the same filter order production has.
 */
const errorBodySchema = z.object({ statusCode: z.number(), message: z.string() });

describe("Serialization conflicts (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      .expect(201)
      .expect((response) => accountSchema.parse(response.body));
    return token;
  }

  /** Every attempt loses the write race, exactly as Postgres would report it. */
  function alwaysConflicts(): jest.SpyInstance {
    return jest.spyOn(prisma, "$transaction").mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("could not serialize access", {
        code: "P2034",
        clientVersion: "test",
      }),
    );
  }

  it("answers an unresolvable write conflict with 503 and Retry-After", async () => {
    const token = await signUp();
    const transaction = alwaysConflicts();

    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Ada", lastName: "Lovelace", addressPostcode: "SW1A 1AA" })
      .expect(503);

    expect(response.headers["retry-after"]).toBe(String(SERIALIZATION_RETRY_AFTER_SECONDS));
    // Retried before giving up — one collision must not fail the request.
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it("says what the client should do, and leaks no database internals", async () => {
    const token = await signUp();
    alwaysConflicts();

    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Grace", lastName: "Hopper", addressPostcode: "SW1A 1AA" })
      .expect(503);

    const body = errorBodySchema.parse(response.body);
    expect(body.statusCode).toBe(503);
    expect(body.message).toMatch(/retry/i);
    expect(JSON.stringify(response.body)).not.toMatch(/P2034|serialize|prisma/i);
  });
});
