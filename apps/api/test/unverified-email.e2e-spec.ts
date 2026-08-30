import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { SUPABASE_ADMIN_CLIENT } from "../src/supabase/supabase-admin.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Three authorization decisions rested on the JWT's `email` claim, which is
 * asserted by the token rather than proven: provisioning a Kudos operator,
 * joining an organisation by invite, and claiming a guest account holding a paid
 * order. Every one of the three docstrings said "verified"; nothing checked.
 *
 * The operator path is the sharpest, because it is the only one with no
 * capability token behind it — `PlatformAdminInvite` is looked up **by email**,
 * so an address alone decides whether someone becomes a Kudos operator with
 * cross-tenant access. See ADR 0188.
 */
describe("An unconfirmed email authorizes nothing (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const getUserById = jest.fn();

  beforeAll(async () => {
    app = await createTestApp([
      {
        provide: SUPABASE_ADMIN_CLIENT,
        useValue: { auth: { admin: { getUserById } } },
      },
    ]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => await app.close());

  beforeEach(() => getUserById.mockReset());

  describe("becoming a Kudos operator", () => {
    /** Allow-list an operator email, the way a super admin does. */
    async function allowList(email: string): Promise<void> {
      await prisma.platformAdminInvite.deleteMany({ where: { email } });
      await prisma.platformAdminInvite.create({
        data: { email, role: "ops", invitedByUserId: randomUUID() },
      });
    }

    it("refuses when Supabase has not confirmed the address", async () => {
      const email = `operator-${randomUUID()}@kudoscards.co.uk`;
      await allowList(email);
      // The authoritative record: this address exists but was never confirmed.
      getUserById.mockResolvedValue({
        data: { user: { email, email_confirmed_at: null } },
        error: null,
      });

      const userId = randomUUID();
      await request(app.getHttpServer())
        .post("/admin/access")
        .set("Authorization", `Bearer ${await mintToken(userId, email)}`)
        .expect(403);

      // And crucially: no operator row was created.
      expect(await prisma.platformAdmin.findUnique({ where: { userId } })).toBeNull();
    });

    it("refuses even when the token swears the address is verified", async () => {
      // `user_metadata` is writable by the user it belongs to, so the token's
      // own word is not evidence. The record is what decides.
      const email = `operator-${randomUUID()}@kudoscards.co.uk`;
      await allowList(email);
      getUserById.mockResolvedValue({
        data: { user: { email, email_confirmed_at: null } },
        error: null,
      });

      const userId = randomUUID();
      await request(app.getHttpServer())
        .post("/admin/access")
        .set("Authorization", `Bearer ${await mintToken(userId, email, true)}`)
        .expect(403);
      expect(await prisma.platformAdmin.findUnique({ where: { userId } })).toBeNull();
    });

    it("provisions the operator once the address is confirmed", async () => {
      const email = `operator-${randomUUID()}@kudoscards.co.uk`;
      await allowList(email);
      getUserById.mockResolvedValue({
        data: { user: { email, email_confirmed_at: new Date().toISOString() } },
        error: null,
      });

      const userId = randomUUID();
      await request(app.getHttpServer())
        .post("/admin/access")
        .set("Authorization", `Bearer ${await mintToken(userId, email)}`)
        .expect(201);
      expect(await prisma.platformAdmin.findUnique({ where: { userId } })).not.toBeNull();
    });
  });

  describe("accepting a team invite", () => {
    it("refuses a session whose email is unconfirmed", async () => {
      // Set up an account with a pending invite.
      const ownerToken = await mintToken(randomUUID(), `owner-${randomUUID()}@example.com`);
      const account = await request(app.getHttpServer())
        .post("/accounts")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "organisation", name: `Invite co ${randomUUID()}` })
        .expect(201);
      // Team invites need a plan with seats.
      await prisma.account.update({
        where: { id: (account.body as { id: string }).id },
        data: { planId: "centre" },
      });
      const invitee = `invitee-${randomUUID()}@example.com`;
      const created = await request(app.getHttpServer())
        .post("/team/invites")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: invitee, role: "staff" })
        .expect(201);
      expect(created.status).toBe(201);
      const invite = await prisma.invite.findFirstOrThrow({ where: { email: invitee } });

      // The invitee holds the emailed token, but their address is unconfirmed —
      // which is exactly the "signed up as someone else" case.
      await request(app.getHttpServer())
        .post(`/invites/${invite.token}/accept`)
        .set("Authorization", `Bearer ${await mintToken(randomUUID(), invitee, false)}`)
        .expect(403);

      const stillPending = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(stillPending.status).toBe("pending");
    });
  });
});
