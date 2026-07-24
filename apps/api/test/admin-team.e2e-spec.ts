import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

interface AdminTeamBody {
  admins: Array<{ userId: string; email: string | null; role: string; isYou: boolean }>;
  invites: Array<{ email: string; role: string }>;
  yourRole: string;
}

describe("Admin team / operator auth (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Deterministic operator counts per test (the last-super-admin guard depends
    // on them). Other specs create their own operators as needed.
    await prisma.platformAdminInvite.deleteMany({});
    await prisma.platformAdmin.deleteMany({});
  });

  async function superAdmin(): Promise<{ token: string; userId: string; email: string }> {
    const userId = randomUUID();
    const email = `super-${userId}@kudos.test`;
    await prisma.platformAdmin.create({ data: { userId, role: "super_admin", email } });
    return { token: await mintToken(userId, email), userId, email };
  }

  async function opsAdmin(): Promise<{ token: string; userId: string }> {
    const userId = randomUUID();
    const email = `ops-${userId}@kudos.test`;
    await prisma.platformAdmin.create({ data: { userId, role: "ops", email } });
    return { token: await mintToken(userId, email), userId };
  }

  it("refuses a non-operator at /admin/me and /admin/access", async () => {
    const userId = randomUUID();
    const token = await mintToken(userId, `nobody-${userId}@x.test`);
    await request(app.getHttpServer())
      .get("/admin/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post("/admin/access")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("provisions an invited operator on first admin access, then consumes the invite", async () => {
    const { token: superToken } = await superAdmin();
    const inviteeEmail = `new-${randomUUID()}@kudos.test`;

    await request(app.getHttpServer())
      .post("/admin/team/invites")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email: inviteeEmail, role: "ops" })
      .expect(201);

    const inviteeUserId = randomUUID();
    const inviteeToken = await mintToken(inviteeUserId, inviteeEmail);
    const access = await request(app.getHttpServer())
      .post("/admin/access")
      .set("Authorization", `Bearer ${inviteeToken}`)
      .expect(201);
    expect(access.body).toMatchObject({ role: "ops", email: inviteeEmail });

    // The operator is now real, and the invite is gone.
    await request(app.getHttpServer())
      .get("/admin/me")
      .set("Authorization", `Bearer ${inviteeToken}`)
      .expect(200);
    const team = await request(app.getHttpServer())
      .get("/admin/team")
      .set("Authorization", `Bearer ${superToken}`)
      .expect(200);
    const body = team.body as AdminTeamBody;
    expect(body.admins.some((a) => a.email === inviteeEmail)).toBe(true);
    expect(body.invites).toHaveLength(0);
  });

  it("does not provision an uninvited user", async () => {
    await superAdmin(); // a super admin exists, but this user isn't invited
    const userId = randomUUID();
    const token = await mintToken(userId, `uninvited-${userId}@kudos.test`);
    await request(app.getHttpServer())
      .post("/admin/access")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("lets an ops operator view the team but not manage it", async () => {
    const { token } = await opsAdmin();
    await request(app.getHttpServer())
      .get("/admin/team")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post("/admin/team/invites")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "x@kudos.test", role: "ops" })
      .expect(403);
  });

  it("keeps at least one super admin", async () => {
    const { token, userId } = await superAdmin(); // the only super admin

    await request(app.getHttpServer())
      .delete(`/admin/team/${userId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/admin/team/${userId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "ops" })
      .expect(409);

    // With a second super admin, revoking the first is allowed.
    const second = await superAdmin();
    await request(app.getHttpServer())
      .delete(`/admin/team/${userId}`)
      .set("Authorization", `Bearer ${second.token}`)
      .expect(200);
  });

  it("promotes and revokes operators (super admin)", async () => {
    const { token: superToken } = await superAdmin();
    const target = await opsAdmin();

    const promoted = await request(app.getHttpServer())
      .patch(`/admin/team/${target.userId}`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ role: "super_admin" })
      .expect(200);
    const body = promoted.body as AdminTeamBody;
    expect(body.admins.find((a) => a.userId === target.userId)?.role).toBe("super_admin");

    await request(app.getHttpServer())
      .delete(`/admin/team/${target.userId}`)
      .set("Authorization", `Bearer ${superToken}`)
      .expect(200);
  });
});
