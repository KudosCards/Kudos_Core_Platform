import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The builder is a raw-HTML sink too.
 *
 * Every write to `MessagePage.message` goes through `cleanMessageHtml`, and the
 * public `/r/` read cleans on the way out as well — its comment says it does so
 * because it is "the only place this HTML is ever executed".
 *
 * It is not. `GET /message-pages/:id` returned the column raw, and in the
 * builder that value reaches two sinks: `MessagePageView`'s
 * `dangerouslySetInnerHTML` and `RichTextEditor`'s `ref.current.innerHTML`.
 * Both on the authenticated origin, where the per-request CSP does not apply —
 * it is gated on `startsWith("/r/")`, and `next.config.ts` sets no headers.
 *
 * So a row written before the write side was sealed executes when the account
 * owner opens their own page to edit it. Self-XSS within one account rather
 * than a cross-tenant hole, and still the last live path.
 *
 * These write the payload straight to the row, because that is the only way to
 * reproduce what the unsanitised writer left behind — going through the API
 * would clean it on the way in and prove nothing.
 */
describe("A message page's detail read is sanitised (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function pageWithStoredMessage(stored: string): Promise<{ token: string; id: string }> {
    const token = await mintToken(randomUUID());
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Msg co ${randomUUID()}` })
      .expect(201);
    const accountId = (created.body as { id: string }).id;
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });

    const page = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "For you" })
      .expect(201);
    const id = (page.body as { id: string }).id;

    // Straight to the column: the vector is a row the old writer left behind.
    await prisma.messagePage.update({ where: { id }, data: { message: stored } });
    return { token, id };
  }

  const detail = async (token: string, id: string): Promise<string | null> => {
    const response = await request(app.getHttpServer())
      .get(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return (response.body as { message: string | null }).message;
  };

  it("strips an inline event handler from a row written before the write side was sealed", async () => {
    // The vector that actually executes. A bare <script> injected via innerHTML
    // does not run, which is why asserting on that one proves little.
    const { token, id } = await pageWithStoredMessage(
      '<p>Happy birthday</p><img src=x onerror="alert(1)">',
    );

    const message = await detail(token, id);

    expect(message).not.toBeNull();
    expect(message!.toLowerCase()).not.toContain("onerror");
    // …and the message itself survives: sanitising is not deleting.
    expect(message).toContain("Happy birthday");
  });

  it("strips a javascript: link target", async () => {
    const { token, id } = await pageWithStoredMessage(
      '<p><a href="javascript:alert(1)">tap here</a></p>',
    );

    const message = await detail(token, id);

    expect(message!.toLowerCase()).not.toContain("javascript:");
    expect(message).toContain("tap here");
  });

  it("leaves ordinary formatting alone", async () => {
    // The builder round-trips this value straight back into a save, so cleaning
    // on read must not quietly rewrite what a customer wrote.
    const stored = "<p>Dear <strong>Ada</strong>,</p><p>Many happy returns.</p>";
    const { token, id } = await pageWithStoredMessage(stored);

    expect(await detail(token, id)).toBe(stored);
  });
});
