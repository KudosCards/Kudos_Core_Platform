import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { SAVED_SEGMENT_WARN_THRESHOLD } from "../src/segments/segments.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The tripwire on ADR 0210's deferred per-account cap.
 *
 * ADR 0233 left the cap unadded on measured evidence — across every account the
 * maximum was one saved list — and put a tripwire in its place so someone would
 * be told before the deferral stopped being safe. The tripwire was a
 * `logger.warn`, and the API's Sentry is errors-only with no console capture,
 * so "someone is told" meant a line in a log nobody tails. It also had no test:
 * nothing caught its removal, or the comparison being inverted.
 *
 * See ADR 0238.
 */
describe("The saved-list tripwire reaches a person (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function accountWithSavedLists(count: number): Promise<{ token: string; id: string }> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Lists co ${randomUUID()}` })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const id = (me.body as { id: string }).id;

    if (count > 0) {
      await prisma.segment.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          accountId: id,
          name: `List ${i}`,
          definition: { contact: { status: "active" } },
        })),
      });
    }
    return { token, id };
  }

  const overview = (token: string) =>
    request(app.getHttpServer()).get("/segments").set("Authorization", `Bearer ${token}`);

  const alertsFor = (accountId: string) =>
    prisma.platformNotification.findMany({
      where: { kind: "saved_lists_over_threshold", entityId: { startsWith: accountId } },
    });

  it("tells an operator when an account crosses the threshold", async () => {
    const operator = randomUUID();
    await prisma.platformAdmin.create({ data: { userId: operator, role: "super_admin" } });
    const { token, id } = await accountWithSavedLists(SAVED_SEGMENT_WARN_THRESHOLD);

    await overview(token).expect(200);

    const alerts = await alertsFor(id);
    // One row per platform admin, all for the one event — so assert the
    // operator got theirs, and that it names the band it crossed.
    expect(alerts.map((a) => a.userId)).toContain(operator);
    expect(alerts.every((a) => a.entityId === `${id}:${SAVED_SEGMENT_WARN_THRESHOLD}`)).toBe(true);
  });

  it("does not tell them again on every page load", async () => {
    // The overview is a page load, not an event. Without the idempotency key
    // this would file one alert per visit and stop being read — which is the
    // failure the log line had in the other direction.
    await prisma.platformAdmin.create({ data: { userId: randomUUID(), role: "super_admin" } });
    const { token, id } = await accountWithSavedLists(SAVED_SEGMENT_WARN_THRESHOLD);

    await overview(token).expect(200);
    // Whatever the first load filed — one row per admin, and admins accumulate
    // across this file — two more loads must add nothing to it.
    const afterFirst = (await alertsFor(id)).length;
    expect(afterFirst).toBeGreaterThan(0);

    await overview(token).expect(200);
    await overview(token).expect(200);

    expect(await alertsFor(id)).toHaveLength(afterFirst);
  });

  it("says nothing for an account below the threshold", async () => {
    // The guard must not turn an ordinary account into an alert.
    await prisma.platformAdmin.create({ data: { userId: randomUUID(), role: "super_admin" } });
    const { token, id } = await accountWithSavedLists(SAVED_SEGMENT_WARN_THRESHOLD - 1);

    await overview(token).expect(200);

    expect(await alertsFor(id)).toEqual([]);
  });
});
