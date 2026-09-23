import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, standingOrderSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import type Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { STANDING_ORDER_CONSENT_VERSION } from "../src/standing-orders/standing-order.consent";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Standing order (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mockStripe = {
      checkout: { sessions: { create: jest.fn() } },
    } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  /** An account whose plan includes automatic sending. */
  async function proAccount(): Promise<{ token: string; accountId: string }> {
    const account = await signUp();
    await prisma.account.update({ where: { id: account.accountId }, data: { planId: "pro" } });
    return account;
  }

  async function createSavedDesign(token: string, name: string): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createList(token: string, name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipient-lists")
      .set("Authorization", `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** "Remove from library". Hard-deletes a design nothing references and
   * archives one something does — a pool membership being one of the things
   * that counts, which is what `archived` below asserts. */
  async function removeDesign(
    token: string,
    savedDesignId: string,
  ): Promise<{ archived: boolean }> {
    const response = await request(app.getHttpServer())
      .delete(`/saved-designs/${savedDesignId}`)
      .set("Authorization", `Bearer ${token}`);
    expect([200, 204]).toContain(response.status);
    return response.body as { archived: boolean };
  }

  function get(token: string) {
    return request(app.getHttpServer())
      .get("/standing-order")
      .set("Authorization", `Bearer ${token}`);
  }

  function save(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put("/standing-order")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  /** The commonest valid body: everybody, one card, one message, agreed. */
  function fullBody(savedDesignIds: string[], overrides: Record<string, unknown> = {}) {
    return {
      enabled: true,
      audience: { kind: "all" },
      postageClass: "second_class",
      savedDesignIds,
      messages: [{ text: "Happy birthday {firstName} — hope it is a good one." }],
      agreeToConsent: true,
      ...overrides,
    };
  }

  it("offers an empty instruction without creating one", async () => {
    const { token, accountId } = await proAccount();

    const response = await get(token).expect(200);
    const order = standingOrderSchema.parse(response.body);
    expect(order.id).toBeNull();
    expect(order.enabled).toBe(false);
    expect(order.audience).toEqual({ kind: "all" });
    expect(order.designs).toEqual([]);
    expect(order.consent).toBeNull();
    expect(order.consentStatement.length).toBeGreaterThan(0);
    expect(order.planAllows).toBe(true);

    // Reading is not setting up. An account that only looked should not have a
    // row, and certainly not one that later reads as a permission.
    expect(await prisma.standingOrder.count({ where: { accountId } })).toBe(0);
  });

  it("says a seeded card can carry a message, because it can", async () => {
    // This shipped answering "no" for every design in existence: the probe that
    // decides it was written with NUL characters and compared against JSON that
    // had escaped them, so the page told every subscriber that none of their
    // cards would use the messages they had just written. Nothing read this
    // field in a test, which is how it got out.
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Balloons");

    await save(token, fullBody([designId])).expect(200);
    const order = standingOrderSchema.parse((await get(token).expect(200)).body);

    expect(order.designs).toHaveLength(1);
    expect(order.designs[0]?.takesMessage).toBe(true);
    expect(order.active).toBe(true);
  });

  it("records who agreed, when, and to which wording", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Balloons");

    const response = await save(token, fullBody([designId])).expect(200);
    const order = standingOrderSchema.parse(response.body);
    expect(order.enabled).toBe(true);
    expect(order.active).toBe(true);
    expect(order.blockers).toEqual([]);
    expect(order.consent).toMatchObject({ version: STANDING_ORDER_CONSENT_VERSION, current: true });

    const row = await prisma.standingOrder.findUniqueOrThrow({ where: { accountId } });
    expect(row.consentedByUserId).not.toBeNull();
    expect(row.consentedAt).not.toBeNull();
    expect(row.consentVersion).toBe(STANDING_ORDER_CONSENT_VERSION);
  });

  it("is switched on but not running when nobody has agreed", async () => {
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Cake");

    const response = await save(token, fullBody([designId], { agreeToConsent: false })).expect(200);
    const order = standingOrderSchema.parse(response.body);
    // "On" and "running" are deliberately different. Saying it is on while
    // nothing happens is the lie this feature cannot afford.
    expect(order.enabled).toBe(true);
    expect(order.active).toBe(false);
    expect(order.blockers).toContain("consent");
    expect(order.consent).toBeNull();
  });

  it("stops running when the wording changes under an old agreement", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Bunting");
    await save(token, fullBody([designId])).expect(200);

    // They agreed to something we have since changed.
    await prisma.standingOrder.update({
      where: { accountId },
      data: { consentVersion: STANDING_ORDER_CONSENT_VERSION - 1 },
    });

    const order = standingOrderSchema.parse((await get(token).expect(200)).body);
    expect(order.active).toBe(false);
    expect(order.blockers).toContain("consent");
    expect(order.consent).toMatchObject({ current: false });
  });

  it("does not quietly re-agree on a later save", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Stars");
    await save(token, fullBody([designId])).expect(200);
    await prisma.standingOrder.update({
      where: { accountId },
      data: { consentVersion: STANDING_ORDER_CONSENT_VERSION - 1 },
    });

    // Switching postage is not agreeing to new wording.
    await save(
      token,
      fullBody([designId], { agreeToConsent: false, postageClass: "first_class" }),
    ).expect(200);

    const row = await prisma.standingOrder.findUniqueOrThrow({ where: { accountId } });
    expect(row.consentVersion).toBe(STANDING_ORDER_CONSENT_VERSION - 1);
    expect(row.postageClass).toBe("first_class");
  });

  it("refuses to run on everybody when the list it named was deleted", async () => {
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Year 4");
    const listId = await createList(token, `Year 4 ${randomUUID()}`);
    await save(token, fullBody([designId], { audience: { kind: "list", listId } })).expect(200);

    await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const order = standingOrderSchema.parse((await get(token).expect(200)).body);
    // The foreign key is SET NULL, so the instruction now reads as "everybody".
    // Thirty children became every contact on the account, and nobody asked for
    // that — so it stops until a person looks at it.
    expect(order.audience).toEqual({ kind: "all" });
    expect(order.active).toBe(false);
    expect(order.blockers).toContain("audience_gone");
  });

  it("stops running when the plan no longer includes automatic sending", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Downgrade");
    await save(token, fullBody([designId])).expect(200);

    await prisma.account.update({ where: { id: accountId }, data: { planId: "free" } });

    const order = standingOrderSchema.parse((await get(token).expect(200)).body);
    expect(order.planAllows).toBe(false);
    expect(order.active).toBe(false);
    expect(order.blockers).toContain("plan");
  });

  it("lets a Free account lay the whole thing out, and refuses only the switch", async () => {
    const { token } = await signUp(); // free plan
    const designId = await createSavedDesign(token, "Free look");

    // Saving it switched off is fine — the point is that the upgrade prompt
    // lands on somebody who has already chosen their cards.
    const saved = await save(token, fullBody([designId], { enabled: false })).expect(200);
    const order = standingOrderSchema.parse(saved.body);
    expect(order.designs).toHaveLength(1);
    expect(order.planAllows).toBe(false);
    expect(order.enabled).toBe(false);

    await save(token, fullBody([designId])).expect(403);
  });

  it("refuses to switch on with nothing to send", async () => {
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Lonely");

    await save(token, fullBody([])).expect(400);
    await save(token, fullBody([designId], { messages: [] })).expect(400);

    // Saved switched off, an empty pool is a legitimate work in progress.
    await save(token, fullBody([], { enabled: false, messages: [] })).expect(200);
  });

  it("refuses a design that is not this account's, or no longer in its library", async () => {
    const { token } = await proAccount();
    const other = await proAccount();
    const theirs = await createSavedDesign(other.token, "Theirs");
    const mine = await createSavedDesign(token, "Mine");

    await save(token, fullBody([theirs])).expect(400);

    await removeDesign(token, mine);
    // Refused, not silently dropped: the cards they think they chose would not
    // be the cards we send.
    await save(token, fullBody([mine])).expect(400);
  });

  it("stops running when a chosen card is archived out of the library", async () => {
    const { token } = await proAccount();
    const keep = await createSavedDesign(token, "Keeper");
    const doomed = await createSavedDesign(token, "Doomed");
    await save(token, fullBody([keep, doomed])).expect(200);

    // Being in a pool makes the design referenced, so removing it archives the
    // design and leaves the pool entry standing — rather than hard-deleting it
    // and narrowing the pool behind the customer's back.
    const removal = await removeDesign(token, doomed);
    expect(removal.archived).toBe(true);

    const order = standingOrderSchema.parse((await get(token).expect(200)).body);
    expect(order.active).toBe(false);
    expect(order.blockers).toContain("design_archived");
    // Still listed, and flagged — a pool that silently shrank would be worse
    // than one that says which card can no longer be sent.
    expect(order.designs).toHaveLength(2);
    expect(order.designs.find((d) => d.savedDesignId === doomed)?.archived).toBe(true);
    expect(order.designs.find((d) => d.savedDesignId === keep)?.archived).toBe(false);

    // Keeping it is refused rather than quietly ignored: saving a pool and
    // getting back a different pool is how somebody ends up sending cards they
    // did not choose.
    await save(token, fullBody([keep, doomed])).expect(400);

    // Dropping it from the pool clears the blocker.
    const fixed = await save(token, fullBody([keep])).expect(200);
    expect(standingOrderSchema.parse(fixed.body).active).toBe(true);
  });

  it("refuses a contact list that is not this account's", async () => {
    const { token } = await proAccount();
    const other = await proAccount();
    const designId = await createSavedDesign(token, "Mine");
    const theirList = await createList(other.token, `Theirs ${randomUUID()}`);

    await save(
      token,
      fullBody([designId], { audience: { kind: "list", listId: theirList } }),
    ).expect(400);
  });

  it("replaces both pools wholesale rather than merging them", async () => {
    const { token, accountId } = await proAccount();
    const first = await createSavedDesign(token, "First");
    const second = await createSavedDesign(token, "Second");
    await save(
      token,
      fullBody([first, second], {
        messages: [{ text: "One {firstName}" }, { text: "Two {firstName}" }],
      }),
    ).expect(200);

    const response = await save(
      token,
      fullBody([second], { messages: [{ text: "Only this one {firstName}" }] }),
    ).expect(200);
    const order = standingOrderSchema.parse(response.body);
    expect(order.designs.map((d) => d.savedDesignId)).toEqual([second]);
    expect(order.messages.map((m) => m.text)).toEqual(["Only this one {firstName}"]);

    const rows = await prisma.standingOrderMessage.count({
      where: { standingOrder: { accountId } },
    });
    expect(rows).toBe(1);
  });

  it("keeps the message pool in the order it was given", async () => {
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Ordered");
    const texts = ["Alpha {firstName}", "Bravo {firstName}", "Charlie {firstName}"];

    const response = await save(
      token,
      fullBody([designId], { messages: texts.map((text) => ({ text })) }),
    ).expect(200);
    expect(standingOrderSchema.parse(response.body).messages.map((m) => m.text)).toEqual(texts);
  });

  it("remembers which messages the subscriber wrote themselves", async () => {
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Sources");

    const response = await save(
      token,
      fullBody([designId], {
        messages: [
          { text: "Mine {firstName}", source: "written" },
          { text: "Drafted for me {firstName}", source: "assisted" },
        ],
      }),
    ).expect(200);
    expect(standingOrderSchema.parse(response.body).messages.map((m) => m.source)).toEqual([
      "written",
      "assisted",
    ]);
  });

  it("refuses a message longer than a card can hold", async () => {
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Long");
    await save(token, fullBody([designId], { messages: [{ text: "x".repeat(501) }] })).expect(400);
  });

  it("refuses a list audience with no list", async () => {
    const { token } = await proAccount();
    const designId = await createSavedDesign(token, "Nolist");
    await save(token, fullBody([designId], { audience: { kind: "list" } })).expect(400);
  });

  it("keeps one account's instruction out of another's", async () => {
    const { token } = await proAccount();
    const other = await proAccount();
    const designId = await createSavedDesign(token, "Mine");
    await save(token, fullBody([designId])).expect(200);

    const theirs = standingOrderSchema.parse((await get(other.token).expect(200)).body);
    expect(theirs.id).toBeNull();
    expect(theirs.designs).toEqual([]);
  });
});
