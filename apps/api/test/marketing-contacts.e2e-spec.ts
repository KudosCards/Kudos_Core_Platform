import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";
import { PrismaService } from "../src/prisma/prisma.service";
import { MARKETING_CONTACTS_CLIENT } from "../src/marketing/marketing-contacts.client";
import type {
  MarketingContactInput,
  MarketingContactsClient,
} from "../src/marketing/marketing-contacts.client";

/**
 * A recording mock for MARKETING_CONTACTS_CLIENT — captures every upsert so we
 * can assert the right list + attributes were sent, and can be told to throw to
 * prove signup survives a Brevo outage. The default list ids (5 individual, 6
 * organisation) come from env.schema defaults; no env is set in tests.
 */
class RecordingMarketingClient implements MarketingContactsClient {
  readonly calls: MarketingContactInput[] = [];
  shouldThrow = false;

  upsertContact(input: MarketingContactInput): Promise<void> {
    this.calls.push(input);
    if (this.shouldThrow) {
      return Promise.reject(new Error("simulated Brevo outage"));
    }
    return Promise.resolve();
  }
}

describe("Subscriber marketing lists (e2e)", () => {
  let app: INestApplication<App>;
  const client = new RecordingMarketingClient();

  beforeAll(async () => {
    app = await createTestApp([{ provide: MARKETING_CONTACTS_CLIENT, useValue: client }]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    client.calls.length = 0;
    client.shouldThrow = false;
  });

  it("adds an individual subscriber to the personal list (5) with first/last name", async () => {
    const token = await mintToken(randomUUID(), "jane.subscriber@example.com");
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "individual", name: "Jane Smith" })
      .expect(201);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      email: "jane.subscriber@example.com",
      firstName: "Jane",
      lastName: "Smith",
      company: undefined,
      listId: 5,
    });
  });

  it("uses explicit first/last name for an individual when the fields are provided", async () => {
    // A surname with spaces ("van der Berg") is exactly the case a last-space
    // split gets wrong — explicit fields must be sent verbatim.
    const token = await mintToken(randomUUID(), "anna@example.com");
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "individual",
        name: "Anna van der Berg",
        firstName: "Anna",
        lastName: "van der Berg",
      })
      .expect(201);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      email: "anna@example.com",
      firstName: "Anna",
      lastName: "van der Berg",
      company: undefined,
      listId: 5,
    });
  });

  it("adds an organisation subscriber to the organisation list (6) with the company name", async () => {
    const token = await mintToken(randomUUID(), "ops@sunrise.example.com");
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: "Sunrise Care Home" })
      .expect(201);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      email: "ops@sunrise.example.com",
      firstName: undefined,
      lastName: undefined,
      company: "Sunrise Care Home",
      listId: 6,
    });
  });

  it("still creates the account when the marketing sync fails (best-effort)", async () => {
    client.shouldThrow = true;
    const token = await mintToken(randomUUID(), "resilient@example.com");

    // Signup must succeed even though the Brevo upsert rejects.
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "individual", name: "Resilient User" })
      .expect(201);

    expect(client.calls).toHaveLength(1);
  });

  it("adds a claimed guest buyer to the INDIVIDUAL list, whatever the account type", async () => {
    // A guest checkout creates the account (here an organisation-typed one) with
    // a claim token + contactEmail. When the buyer claims it, they're a person,
    // so they must land on the individual list (5), not the organisation list.
    const prisma = app.get(PrismaService);
    const email = `guest-${randomUUID()}@example.com`;
    const claimToken = `claim-${randomUUID()}`;
    await prisma.account.create({
      data: {
        type: "organisation",
        name: "Guest Buyer Ltd",
        planId: "free",
        contactEmail: email,
        claimToken,
        claimTokenExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const token = await mintToken(randomUUID(), email);
    await request(app.getHttpServer())
      .post("/guest/claim")
      .set("Authorization", `Bearer ${token}`)
      .send({ claimToken })
      .expect(201);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      email,
      firstName: undefined,
      lastName: undefined,
      company: undefined,
      listId: 5,
    });
  });
});
