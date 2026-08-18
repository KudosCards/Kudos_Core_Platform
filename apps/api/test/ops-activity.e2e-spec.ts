import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { OpsDigestService } from "../src/ops-activity/ops-digest.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Kudos HQ's view of business activity, end to end against the real DB.
 *
 * The unit specs cover the wording and the failure handling. What can only be
 * proved here is the wiring: that a real signup through the real HTTP route
 * actually reaches a real operator's bell, and that the digest's queries mean
 * what they're supposed to against real rows — in particular that a guest
 * account is not a sign-up.
 */
describe("Ops activity (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let digest: OpsDigestService;
  /** Created before any digest runs. It has to be: notifyAllAdmins is
   *  idempotent on (kind, entityId) across *all* operators, so once a day's
   *  digest entry exists, an operator added later gets no backfilled row for
   *  that day. That's the intended "first run wins" behaviour — it just means a
   *  test can't create its operator after the fact and expect to see it. */
  let superAdmin: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    digest = app.get(OpsDigestService);
    // The digest's day-keyed entry survives between runs in the shared test DB,
    // and a leftover row would make notifyAllAdmins a no-op for this run's
    // operators. Same per-spec cleanup the admin-team/billing specs do.
    await prisma.platformNotification.deleteMany({ where: { kind: "daily_summary" } });
    superAdmin = await createOperator("super_admin");
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOperator(role = "ops"): Promise<{ token: string; userId: string }> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role } });
    return { token: await mintToken(userId), userId };
  }

  async function signUp(name: string): Promise<string> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it("puts a real signup in a real operator's bell", async () => {
    const operator = await createOperator();
    const name = `Bright Sparks ${randomUUID().slice(0, 8)}`;

    const accountId = await signUp(name);

    const notification = await prisma.platformNotification.findFirst({
      where: { userId: operator.userId, kind: "new_signup", entityId: accountId },
    });
    expect(notification).not.toBeNull();
    expect(notification?.title).toBe(`New sign-up — ${name}`);
    expect(notification?.href).toBe(`/admin/subscribers/${accountId}`);

    // And it's readable through the operator's own endpoint, not just in the DB.
    const list = await request(app.getHttpServer())
      .get("/admin/notifications")
      .set("Authorization", `Bearer ${operator.token}`)
      .expect(200);
    const body = list.body as { items: { kind: string; entityId?: string }[] };
    expect(body.items.some((item) => item.kind === "new_signup")).toBe(true);
  });

  it("notifies every operator once per signup", async () => {
    const first = await createOperator();
    const second = await createOperator();

    const accountId = await signUp(`Two Ops ${randomUUID().slice(0, 8)}`);

    const rows = await prisma.platformNotification.findMany({
      where: { kind: "new_signup", entityId: accountId },
      select: { userId: true },
    });
    const userIds = rows.map((row) => row.userId);
    expect(userIds).toEqual(expect.arrayContaining([first.userId, second.userId]));
    expect(new Set(userIds).size).toBe(userIds.length);
  });

  it("counts an account with an owner as a sign-up, and a guest shell as nothing", async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(12, 0, 0, 0);

    // A real signup, backdated into the digest's window.
    const signedUpId = await signUp(`Digest Centre ${randomUUID().slice(0, 8)}`);
    await prisma.membership.updateMany({
      where: { accountId: signedUpId },
      data: { createdAt: yesterday },
    });

    // A guest one-off buyer's account: a real Account row, no membership. This
    // is the row that would make a naive "count accounts" query wrong.
    const guest = await prisma.account.create({
      data: {
        type: "individual",
        name: "Guest",
        planId: "free",
        contactEmail: `guest-${randomUUID()}@example.com`,
        claimToken: randomUUID(),
        claimTokenExpiresAt: new Date(Date.now() + 86_400_000),
        createdAt: yesterday,
      },
    });

    const summary = await digest.runDailyDigest();

    const ids = summary.signups.map((signup) => signup.accountId);
    expect(ids).toContain(signedUpId);
    expect(ids).not.toContain(guest.id);
  });

  it("records the digest in the ops notification centre, once per day", async () => {
    // The digest has already run in an earlier test in this file; running it
    // again must not add a second row for the same day.
    const summary = await digest.runDailyDigest();
    await digest.runDailyDigest();

    const rows = await prisma.platformNotification.findMany({
      where: { userId: superAdmin.userId, kind: "daily_summary", entityId: summary.day },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe("/admin");
  });
});
