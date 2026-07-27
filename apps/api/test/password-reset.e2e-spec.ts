import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { SUPABASE_ADMIN_CLIENT } from "../src/supabase/supabase-admin.provider";
import { createTestApp } from "./util/create-test-app";

const emailMock = { sendTransactional: jest.fn().mockResolvedValue(undefined) };
const generateLinkMock = jest.fn();
const supabaseAdminMock = { auth: { admin: { generateLink: generateLinkMock } } };

describe("Password reset (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp([
      { provide: EMAIL_CLIENT, useValue: emailMock },
      { provide: SUPABASE_ADMIN_CLIENT, useValue: supabaseAdminMock },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    emailMock.sendTransactional.mockClear();
    generateLinkMock.mockReset();
  });

  it("emails a recovery link for a known address and returns 200 (no auth required)", async () => {
    generateLinkMock.mockResolvedValue({
      data: { properties: { action_link: "https://supabase.test/auth/v1/verify?token=xyz" } },
      error: null,
    });

    await request(app.getHttpServer())
      .post("/auth/request-password-reset")
      .send({ email: "known@kudos.test" })
      .expect(200);

    expect(generateLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recovery", email: "known@kudos.test" }),
    );
    expect(emailMock.sendTransactional).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "known@kudos.test",
        html: expect.stringContaining("https://supabase.test/auth/v1/verify?token=xyz"),
      }),
    );
  });

  it("still returns 200 but sends nothing for an unknown address (no account enumeration)", async () => {
    generateLinkMock.mockResolvedValue({
      data: null,
      error: { code: "user_not_found", message: "User not found" },
    });

    await request(app.getHttpServer())
      .post("/auth/request-password-reset")
      .send({ email: "unknown@kudos.test" })
      .expect(200);

    expect(emailMock.sendTransactional).not.toHaveBeenCalled();
  });

  it("still returns 200 even if the email send fails (never leaks a failure)", async () => {
    generateLinkMock.mockResolvedValue({
      data: { properties: { action_link: "https://supabase.test/auth/v1/verify?token=xyz" } },
      error: null,
    });
    emailMock.sendTransactional.mockRejectedValueOnce(new Error("brevo down"));

    await request(app.getHttpServer())
      .post("/auth/request-password-reset")
      .send({ email: "known@kudos.test" })
      .expect(200);
  });

  it("rejects a malformed email", async () => {
    await request(app.getHttpServer())
      .post("/auth/request-password-reset")
      .send({ email: "not-an-email" })
      .expect(400);
  });
});
