import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { SUPABASE_ADMIN_CLIENT } from "../src/supabase/supabase-admin.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const emailMock = { sendTransactional: jest.fn().mockResolvedValue(undefined) };

// Fakes the service-role Supabase admin client so no real Supabase Auth call is
// made. Default: a fresh invite mints a set-password action link.
const generateLinkMock = jest.fn().mockResolvedValue({
  data: { properties: { hashed_token: "hash-abc" } },
  error: null,
});
const getUserByIdMock = jest.fn().mockResolvedValue({ data: { user: null }, error: null });
const supabaseAdminMock = {
  auth: { admin: { generateLink: generateLinkMock, getUserById: getUserByIdMock } },
};

interface AdminTeamBody {
  admins: Array<{ userId: string; email: string | null; role: string; isYou: boolean }>;
  invites: Array<{ email: string; role: string }>;
  yourRole: string;
}

describe("Admin team / operator auth (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([
      { provide: EMAIL_CLIENT, useValue: emailMock },
      { provide: SUPABASE_ADMIN_CLIENT, useValue: supabaseAdminMock },
    ]);
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
    emailMock.sendTransactional.mockClear();
    getUserByIdMock.mockClear();
    getUserByIdMock.mockResolvedValue({ data: { user: null }, error: null });
    generateLinkMock.mockClear();
    generateLinkMock.mockResolvedValue({
      data: { properties: { hashed_token: "hash-abc" } },
      error: null,
    });
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

    // The invitee's Supabase auth user is created + a set-password link minted,
    // and they're emailed that link (not just told to go sign in).
    expect(generateLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "invite", email: inviteeEmail }),
    );
    // The email carries a token_hash link to our own set-password page — not the
    // raw Supabase action_link — so it works with the PKCE browser client and
    // survives email-scanner pre-fetching. See docs/adr/0051.
    expect(emailMock.sendTransactional).toHaveBeenCalledWith(
      expect.objectContaining({
        to: inviteeEmail,
        html: expect.stringContaining("/admin-set-password?token_hash=hash-abc&type=invite"),
      }),
    );

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

  it("provisions an invited operator whose session token carries no email (admin-client fallback)", async () => {
    const { token: superToken } = await superAdmin();
    const inviteeEmail = `noemail-${randomUUID()}@kudos.test`;
    await request(app.getHttpServer())
      .post("/admin/team/invites")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email: inviteeEmail, role: "ops" })
      .expect(201);

    // A session whose JWT has no `email` claim — the invite would dead-end at
    // "not a Kudos operator" without the authoritative Supabase lookup.
    const inviteeUserId = randomUUID();
    getUserByIdMock.mockResolvedValue({
      data: { user: { id: inviteeUserId, email: inviteeEmail } },
      error: null,
    });
    const inviteeToken = await mintToken(inviteeUserId, null);

    const access = await request(app.getHttpServer())
      .post("/admin/access")
      .set("Authorization", `Bearer ${inviteeToken}`)
      .expect(201);
    expect(access.body).toMatchObject({ role: "ops", email: inviteeEmail });
    expect(getUserByIdMock).toHaveBeenCalledWith(inviteeUserId);
  });

  it("sends a recovery set-password link when the invitee already exists in Supabase", async () => {
    const { token: superToken } = await superAdmin();
    const existingEmail = `existing-${randomUUID()}@kudos.test`;
    // invite → email_exists (no link), then recovery → a set-password link. An
    // existing user may have no password yet, so they still need to set one.
    generateLinkMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: "email_exists", message: "A user with this email already exists" },
      })
      .mockResolvedValueOnce({
        data: { properties: { hashed_token: "hash-rec" } },
        error: null,
      });

    await request(app.getHttpServer())
      .post("/admin/team/invites")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email: existingEmail, role: "ops" })
      .expect(201);

    // Second call is a recovery link, and the email carries a set-password link
    // (not a bare "go sign in" pointer).
    expect(generateLinkMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "recovery", email: existingEmail }),
    );
    const calls = emailMock.sendTransactional.mock.calls as Array<[{ to: string; html: string }]>;
    const call = calls.at(-1)?.[0];
    expect(call?.to).toBe(existingEmail);
    expect(call?.html).toContain("/admin-set-password?token_hash=hash-rec&type=recovery");
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

  it("resends the invite email for a pending invite", async () => {
    const { token: superToken } = await superAdmin();
    const inviteeEmail = `resend-${randomUUID()}@kudos.test`;
    await request(app.getHttpServer())
      .post("/admin/team/invites")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email: inviteeEmail, role: "ops" })
      .expect(201);

    emailMock.sendTransactional.mockClear();
    await request(app.getHttpServer())
      .post("/admin/team/invites/resend")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email: inviteeEmail })
      .expect(201);
    expect(emailMock.sendTransactional).toHaveBeenCalledWith(
      expect.objectContaining({ to: inviteeEmail }),
    );
  });

  it("404s resending a non-existent invite, and blocks ops operators", async () => {
    const { token: superToken } = await superAdmin();
    await request(app.getHttpServer())
      .post("/admin/team/invites/resend")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email: "nobody@kudos.test" })
      .expect(404);

    const ops = await opsAdmin();
    await request(app.getHttpServer())
      .post("/admin/team/invites/resend")
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ email: "nobody@kudos.test" })
      .expect(403);
  });

  it("surfaces a send failure on resend (502) rather than a false success", async () => {
    const { token: superToken } = await superAdmin();
    const email = `fail-${randomUUID()}@kudos.test`;
    await request(app.getHttpServer())
      .post("/admin/team/invites")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email, role: "ops" })
      .expect(201);

    emailMock.sendTransactional.mockRejectedValueOnce(new Error("brevo down"));
    await request(app.getHttpServer())
      .post("/admin/team/invites/resend")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ email })
      .expect(502);
  });

  it("reports whether transactional email is configured", async () => {
    const { token } = await opsAdmin();
    const res = await request(app.getHttpServer())
      .get("/admin/email-status")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(typeof (res.body as { configured: unknown }).configured).toBe("boolean");
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
