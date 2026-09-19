import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * "Ready to send" has to mean the send path will accept it.
 *
 * It did not. `bulkSend` has always refused a recipient whose country is not
 * the UK, while the dashboard count, the contacts filter, the smart-list rule
 * and the CRM readiness panel looked only at line 1, town and postcode. A
 * contact with a complete US address was counted as ready in four places and
 * refused in the fifth — invisible while every contact was British, and the
 * first thing an international customer would have seen.
 *
 * See docs/uk-scope-messaging-plan.md.
 */
describe("A mailable contact is one we can actually post to (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
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
      .send({ type: "organisation", name: `Test Co ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  async function addContact(
    accountId: string,
    firstName: string,
    addressCountry: string | null,
  ): Promise<void> {
    await prisma.recipient.create({
      data: {
        accountId,
        firstName,
        lastName: "Tester",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
        addressCountry,
        source: "manual",
      },
    });
  }

  /** The contacts the "needs an address" filter says are not mailable. */
  async function needsAddress(token: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get("/recipients?missingAddress=true&perPage=100")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return (res.body as { items: { firstName: string }[] }).items.map((r) => r.firstName);
  }

  it("leaves a contact with no country on file mailable", async () => {
    // The whole risk of this change. Every contact added by hand or imported
    // from CSV before the column was populated holds null, and reading that as
    // foreign would empty every customer's mailable list overnight.
    const { token, accountId } = await signUp();
    await addContact(accountId, "Unset", null);

    expect(await needsAddress(token)).toEqual([]);
  });

  it("leaves an ordinary UK account's counts exactly as they were", async () => {
    // The test that matters to existing customers: nothing moves for them.
    const { token, accountId } = await signUp();
    await addContact(accountId, "Gb", "GB");
    await addContact(accountId, "Unset", null);
    await addContact(accountId, "Spelled", "United Kingdom");
    await addContact(accountId, "Lower", "gb");
    await addContact(accountId, "Nation", "Scotland");

    expect(await needsAddress(token)).toEqual([]);
  });

  it("stops calling an overseas address ready to send", async () => {
    const { token, accountId } = await signUp();
    await addContact(accountId, "Overseas", "US");

    expect(await needsAddress(token)).toEqual(["Overseas"]);
  });

  /**
   * The other half of the rule, and the reason it has its own tests: the send
   * path calls `isUkCountry`, while the readiness query filters on
   * `UK_COUNTRY_VALUES` through Prisma. Two implementations of one rule, and a
   * mutation proved they can drift — breaking `isUkCountry`'s handling of an
   * unset country left every readiness test above passing, because SQL's
   * `NULL NOT IN (...)` is never true regardless.
   *
   * So the send path is pinned here too. If the two ever disagree about a
   * country, one of these four tests fails.
   */
  describe("and the send path agrees with it", () => {
    async function savedDesignId(token: string): Promise<string> {
      const templates = await request(app.getHttpServer())
        .get("/card-designs")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const cardDesignId = (templates.body as { id: string }[])[0]!.id;
      const design = await request(app.getHttpServer())
        .post("/saved-designs")
        .set("Authorization", `Bearer ${token}`)
        .send({ cardDesignId, name: "Scope test design" })
        .expect(201);
      return (design.body as { id: string }).id;
    }

    /** Recipient ids the pre-send check refuses over their address. */
    async function refusedByPreflight(token: string, ids: string[]): Promise<string[]> {
      const res = await request(app.getHttpServer())
        .post("/batch-orders/preflight")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId: await savedDesignId(token),
          recipientIds: ids,
          postageClass: "second_class",
        })
        .expect(201);
      // Both address buckets: "no address at all" and "has one but we cannot
      // post to it" are one question here.
      const body = res.body as {
        missingAddress: { sample: { recipientId: string }[] };
        invalidPostcode: { sample: { recipientId: string }[] };
      };
      return [...body.missingAddress.sample, ...body.invalidPostcode.sample].map(
        (f) => f.recipientId,
      );
    }

    it("posts to a contact with no country on file", async () => {
      const { token, accountId } = await signUp();
      await addContact(accountId, "Unset", null);
      const contact = await prisma.recipient.findFirstOrThrow({ where: { accountId } });

      expect(await refusedByPreflight(token, [contact.id])).toEqual([]);
    });

    it("posts to a contact whose country is spelled out, as a CRM sync stores it", async () => {
      // The live defect: HubSpot's standard country property reads "United
      // Kingdom", the send path compared it to "GB" exactly, and a deliverable
      // synced contact was refused as a "Non-UK address (United Kingdom)".
      const { token, accountId } = await signUp();
      await addContact(accountId, "Spelled", "United Kingdom");
      const contact = await prisma.recipient.findFirstOrThrow({ where: { accountId } });

      expect(await refusedByPreflight(token, [contact.id])).toEqual([]);
    });

    it("still refuses an overseas address", async () => {
      const { token, accountId } = await signUp();
      await addContact(accountId, "Overseas", "US");
      const contact = await prisma.recipient.findFirstOrThrow({ where: { accountId } });

      expect(await refusedByPreflight(token, [contact.id])).toEqual([contact.id]);
    });
  });

  it("agrees with the dashboard's needs-address count", async () => {
    // One definition, four readers. This is the second of them.
    const { token, accountId } = await signUp();
    await addContact(accountId, "Overseas", "US");
    await addContact(accountId, "Home", "GB");

    const summary = await request(app.getHttpServer())
      .get("/accounts/me/summary")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect((summary.body as { contactsMissingAddress: number }).contactsMissingAddress).toBe(1);
  });
});
