import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const teamSchema = z.object({
  members: z.array(
    z.object({ userId: z.string(), email: z.string().nullable(), role: z.string(), isYou: z.boolean() }),
  ),
  invites: z.array(z.object({ id: z.string().uuid(), email: z.string(), role: z.string(), status: z.string() })),
  teamSeatsEnabled: z.boolean(),
  yourRole: z.string(),
});

describe("Team / invites (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sendTransactional: jest.Mock;

  beforeAll(async () => {
    sendTransactional = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp([{ provide: EMAIL_CLIENT, useValue: { sendTransactional } }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => sendTransactional.mockClear());

  /** Sign up an owner. `centre` upgrades the account so team seats are enabled. */
  async function signUpOwner(opts: { centre?: boolean; email?: string } = {}): Promise<{
    token: string;
    accountId: string;
    userId: string;
  }> {
    const userId = randomUUID();
    const email = opts.email ?? `owner-${userId.slice(0, 8)}@example.com`;
    const token = await mintToken(userId, email);
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(response.body).id;
    if (opts.centre) {
      await prisma.account.update({ where: { id: accountId }, data: { planId: "centre" } });
    }
    return { token, accountId, userId };
  }

  /** Read an invite's secret token straight from the DB (never returned by API). */
  async function inviteToken(accountId: string, email: string): Promise<string> {
    const invite = await prisma.invite.findUniqueOrThrow({
      where: { accountId_email: { accountId, email: email.toLowerCase() } },
    });
    return invite.token;
  }

  it("captures the owner's email on their membership at signup", async () => {
    const owner = await signUpOwner({ email: "founder@centre.test" });
    const response = await request(app.getHttpServer())
      .get("/team")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    const team = teamSchema.parse(response.body);
    expect(team.members).toHaveLength(1);
    expect(team.members[0]).toMatchObject({ role: "owner", email: "founder@centre.test", isYou: true });
    expect(team.yourRole).toBe("owner");
  });

  it("blocks inviting on a plan without team seats (free)", async () => {
    const owner = await signUpOwner();
    await request(app.getHttpServer())
      .post("/team/invites")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ email: "staff@centre.test", role: "staff" })
      .expect(403);
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it("invites, emails a link, and lets the invitee accept and join", async () => {
    const owner = await signUpOwner({ centre: true });

    const inviteResponse = await request(app.getHttpServer())
      .post("/team/invites")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ email: "Staff@Centre.test", role: "staff" })
      .expect(201);
    // The response never leaks the secret token.
    expect(inviteResponse.body).not.toHaveProperty("token");
    expect(inviteResponse.body).toMatchObject({ email: "staff@centre.test", role: "staff", status: "pending" });

    // An email with the accept link was sent to the (lowercased) invitee.
    expect(sendTransactional).toHaveBeenCalledTimes(1);
    const emailArg = (sendTransactional.mock.calls[0] as [{ to: string; html: string }])[0];
    expect(emailArg.to).toBe("staff@centre.test");
    const token = await inviteToken(owner.accountId, "staff@centre.test");
    expect(emailArg.html).toContain(`/invite/${token}`);

    // Public preview works for the token holder.
    const preview = await request(app.getHttpServer()).get(`/invites/${token}`).expect(200);
    expect(preview.body).toMatchObject({ email: "staff@centre.test", role: "staff", status: "pending", expired: false });

    // The invitee signs in with the matching email and accepts.
    const staffUserId = randomUUID();
    const staffToken = await mintToken(staffUserId, "staff@centre.test");
    await request(app.getHttpServer())
      .post(`/invites/${token}/accept`)
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(201);

    // They're now a staff member of the owner's account.
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: staffUserId } });
    expect(membership).toMatchObject({ accountId: owner.accountId, role: "staff", email: "staff@centre.test" });
    // Invite is marked accepted; team now shows two members and no pending invites.
    const team = teamSchema.parse(
      (await request(app.getHttpServer()).get("/team").set("Authorization", `Bearer ${owner.token}`).expect(200)).body,
    );
    expect(team.members).toHaveLength(2);
    expect(team.invites).toHaveLength(0);

    // The existing owner got a persisted "someone joined" inbox notification;
    // the joiner did not (we notify before adding their membership). See ADR 0034.
    const ownerNotes = await prisma.notification.findMany({
      where: { userId: owner.userId, kind: "invite_accepted" },
    });
    expect(ownerNotes).toHaveLength(1);
    expect(ownerNotes[0]?.title).toContain("staff@centre.test");
    const joinerNotes = await prisma.notification.count({
      where: { userId: staffUserId, kind: "invite_accepted" },
    });
    expect(joinerNotes).toBe(0);
  });

  it("rejects accepting with a different email than the invite", async () => {
    const owner = await signUpOwner({ centre: true });
    await request(app.getHttpServer())
      .post("/team/invites")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ email: "invitee@centre.test", role: "admin" })
      .expect(201);
    const token = await inviteToken(owner.accountId, "invitee@centre.test");

    const wrongToken = await mintToken(randomUUID(), "someone-else@evil.test");
    await request(app.getHttpServer())
      .post(`/invites/${token}/accept`)
      .set("Authorization", `Bearer ${wrongToken}`)
      .expect(403);
  });

  it("rejects accepting when the user already belongs to an account", async () => {
    const owner = await signUpOwner({ centre: true });
    await request(app.getHttpServer())
      .post("/team/invites")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ email: "hasaccount@centre.test", role: "staff" })
      .expect(201);
    const token = await inviteToken(owner.accountId, "hasaccount@centre.test");

    // This invitee already owns their own account.
    const other = await signUpOwner({ email: "hasaccount@centre.test" });
    await request(app.getHttpServer())
      .post(`/invites/${token}/accept`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(409);
  });

  it("only owner/admin can invite; staff cannot", async () => {
    const owner = await signUpOwner({ centre: true });
    // Add a staff member directly.
    const staffUserId = randomUUID();
    await prisma.membership.create({
      data: { accountId: owner.accountId, userId: staffUserId, role: "staff", email: "s@centre.test" },
    });
    const staffToken = await mintToken(staffUserId, "s@centre.test");
    await request(app.getHttpServer())
      .post("/team/invites")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ email: "another@centre.test", role: "staff" })
      .expect(403);
  });

  it("owner can remove a member and change roles; the owner can't be removed", async () => {
    const owner = await signUpOwner({ centre: true });
    const staffUserId = randomUUID();
    await prisma.membership.create({
      data: { accountId: owner.accountId, userId: staffUserId, role: "staff", email: "member@centre.test" },
    });

    // Promote to admin.
    await request(app.getHttpServer())
      .patch(`/team/members/${staffUserId}/role`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "admin" })
      .expect(204);
    expect(
      (await prisma.membership.findFirstOrThrow({ where: { userId: staffUserId } })).role,
    ).toBe("admin");

    // You can't remove yourself (the owner would otherwise orphan the account).
    await request(app.getHttpServer())
      .delete(`/team/members/${owner.userId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(400);

    // Remove the member.
    await request(app.getHttpServer())
      .delete(`/team/members/${staffUserId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(204);
    expect(await prisma.membership.findFirst({ where: { userId: staffUserId } })).toBeNull();
  });

  it("revokes a pending invite", async () => {
    const owner = await signUpOwner({ centre: true });
    const created = await request(app.getHttpServer())
      .post("/team/invites")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ email: "revokeme@centre.test", role: "staff" })
      .expect(201);
    const inviteId = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/team/invites/${inviteId}/revoke`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(204);

    const token = await inviteToken(owner.accountId, "revokeme@centre.test");
    // A revoked invite can no longer be accepted.
    const staffToken = await mintToken(randomUUID(), "revokeme@centre.test");
    await request(app.getHttpServer())
      .post(`/invites/${token}/accept`)
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(404);
  });
});
