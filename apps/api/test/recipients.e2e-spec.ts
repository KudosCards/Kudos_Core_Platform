import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, recipientSchema, csvImportPreviewSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const paginatedRecipientsSchema = z.object({
  items: z.array(recipientSchema),
  total: z.number(),
  page: z.number(),
  perPage: z.number(),
});

const importSummarySchema = z.object({
  created: z.number(),
  updated: z.number(),
  rejected: z.array(z.object({ row: z.number(), reason: z.string() })),
  warnings: z.array(z.object({ row: z.number(), message: z.string() })),
});

/** Just enough of the occasions list to assert birthday scheduling. */
const occasionListSchema = z.object({
  items: z.array(
    z.object({
      type: z.string(),
      status: z.string(),
      occasionDate: z.string(),
    }),
  ),
});

describe("Recipients (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  /** Set by a test to race a colliding recipient in just before the import's
   * createMany — the window `skipDuplicates` exists for. */
  let raceBeforeCreateMany: (() => Promise<void>) | null = null;
  /** Set by a test to inspect every Recipient.findMany the request issues. */
  /** Set by a test to measure how many Recipient.update calls overlap. */
  let watchRecipientUpdate: { enter: () => void; leave: () => void } | null = null;
  /** Set by a test to make the Nth Recipient.update fail, the way a row deleted
   * between the dedupe lookup and the write would. */
  let failRecipientUpdates: number | null = null;
  let watchRecipientFindMany:
    ((args: { take?: number; where?: unknown } | undefined) => void) | null = null;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    prisma.$use(async (params, next) => {
      if (raceBeforeCreateMany && params.model === "Recipient" && params.action === "createMany") {
        const race = raceBeforeCreateMany;
        raceBeforeCreateMany = null;
        await race();
      }
      if (watchRecipientFindMany && params.model === "Recipient" && params.action === "findMany") {
        watchRecipientFindMany(params.args as { take?: number; where?: unknown } | undefined);
      }
      if (
        failRecipientUpdates !== null &&
        failRecipientUpdates > 0 &&
        params.model === "Recipient" &&
        params.action === "update"
      ) {
        failRecipientUpdates -= 1;
        throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      }
      if (watchRecipientUpdate && params.model === "Recipient" && params.action === "update") {
        const watcher = watchRecipientUpdate;
        watcher.enter();
        try {
          const updated: unknown = await next(params);
          return updated;
        } finally {
          watcher.leave();
        }
      }
      const result: unknown = await next(params);
      return result;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Signs up a fresh account and returns a bearer token authorised against it. */
  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  /** A full, mailable address, for tests that need a sendable contact. */
  const MAILABLE = {
    addressLine1: "1 Test Street",
    addressCity: "London",
    addressPostcode: "SW1A 1AA",
  } as const;

  /** Creates an unmailable contact straight through Prisma. The manual-add API
   * now also accepts addressless contacts (ADR 0067), but this keeps the older
   * import-and-flag callers' shape for tests that predate that. */
  async function createUnmailableRecipient(
    accountId: string,
    data: { firstName: string; lastName: string; addressPostcode?: string },
  ): Promise<string> {
    const recipient = await prisma.recipient.create({ data: { accountId, ...data } });
    return recipient.id;
  }

  it("creates a recipient and lists it back", async () => {
    const { token } = await signUp();

    const createResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Archie", lastName: "Winn", ...MAILABLE })
      .expect(201);
    const created = recipientSchema.parse(createResponse.body);

    expect(created).toMatchObject({
      firstName: "Archie",
      lastName: "Winn",
      status: "active",
    });

    const listResponse = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(listResponse.body);

    expect(list.total).toBe(1);
    expect(list.items[0]?.id).toBe(created.id);
  });

  it("filters to contacts missing a mailable address with ?missingAddress=true", async () => {
    const { token, accountId } = await signUp();

    // Mailable (full address) via the API vs unmailable (postcode only, no line 1
    // / city) — the latter can now only arrive via an import-and-flag path, so
    // it's created straight through Prisma.
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Full", lastName: "Address", ...MAILABLE, addressLine1: "12 King Street" })
      .expect(201);
    await createUnmailableRecipient(accountId, {
      firstName: "Needs",
      lastName: "Address",
      addressPostcode: "M1 2AB",
    });

    const filtered = await request(app.getHttpServer())
      .get("/recipients?missingAddress=true")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(filtered.body);
    expect(list.total).toBe(1);
    expect(list.items[0]?.firstName).toBe("Needs");

    // Unfiltered still returns both.
    const all = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(paginatedRecipientsSchema.parse(all.body).total).toBe(2);
  });

  it("filters contacts by birthday month with ?birthMonth, ignoring the year", async () => {
    const { token } = await signUp();
    const add = (firstName: string, dateOfBirth: string) =>
      request(app.getHttpServer())
        .post("/recipients")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName, lastName: "Birthday", dateOfBirth, ...MAILABLE })
        .expect(201);

    // Two August birthdays in different years, one May, one with no DOB at all.
    await add("Augusta", "2015-08-14");
    await add("Gus", "1990-08-30");
    await add("Mabel", "2001-05-02");
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Nodob", lastName: "Person", ...MAILABLE })
      .expect(201);

    const august = await request(app.getHttpServer())
      .get("/recipients?birthMonth=8")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(august.body);
    expect(list.total).toBe(2);
    expect(list.items.map((r) => r.firstName).sort()).toEqual(["Augusta", "Gus"]);

    // A month with no birthdays returns nothing (not an error).
    const january = await request(app.getHttpServer())
      .get("/recipients?birthMonth=1")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(paginatedRecipientsSchema.parse(january.body).total).toBe(0);

    // An out-of-range month is rejected by validation.
    await request(app.getHttpServer())
      .get("/recipients?birthMonth=13")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });

  it("imports a full postal address from CSV so the contact is mailable", async () => {
    const { token } = await signUp();
    const csv =
      "firstName,lastName,addressLine1,addressCity,postcode\n" +
      "Csv,Person,9 Oak Road,Leeds,LS1 1AA\n";
    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "contacts.csv")
      .expect(201);

    const list = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const item = paginatedRecipientsSchema.parse(list.body).items[0];
    expect(item).toMatchObject({
      addressLine1: "9 Oak Road",
      addressCity: "Leeds",
      addressPostcode: "LS1 1AA",
    });
  });

  it("reads recipients in bounded pages when scheduling birthdays after an import", async () => {
    // Every import calls ensureScheduledBirthdays, which read *every* active
    // recipient with a date of birth into memory in one go. Centre's cap is
    // 2,000 and Enterprise has none, so "any plan's cap (50-200)" — the premise
    // the unbounded read was written under — has not held for a while.
    const { token } = await signUp();
    // Only the birthday read: the dedupe lookup is bounded by chunking its OR
    // terms rather than by `take`, because a `take` there would silently drop
    // matches instead of limiting work.
    const unbounded: unknown[] = [];
    watchRecipientFindMany = (args) => {
      const where = args?.where as { dateOfBirth?: unknown } | undefined;
      if (where?.dateOfBirth !== undefined && args?.take === undefined) unbounded.push(args);
    };
    try {
      await request(app.getHttpServer())
        .post("/recipients/import")
        .set("Authorization", `Bearer ${token}`)
        .attach(
          "file",
          Buffer.from("firstName,lastName,dateOfBirth\nPaged,Contact,01/02/2015\n"),
          "contacts.csv",
        )
        .expect(201);
    } finally {
      watchRecipientFindMany = null;
    }

    expect(unbounded).toHaveLength(0);
  });

  it("bounds how many contact updates it runs at once", async () => {
    // The most common real import is a corrected re-upload of the same file,
    // where every row matches an existing contact. Firing one UPDATE per row at
    // once exhausts the Prisma pool and stalls every other request on the
    // instance; the work does not finish sooner for it.
    const { token } = await signUp();
    const rows = Array.from(
      { length: 40 },
      (_, i) => `Person${i},Contact,SW1A ${i}AA,person${i}@example.com`,
    );
    const header = "firstName,lastName,postcode,email\n";
    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(header + rows.join("\n") + "\n"), "contacts.csv")
      .expect(201);

    // Re-upload the same file with changed emails: every row is now an update.
    let inFlight = 0;
    let peak = 0;
    watchRecipientUpdate = {
      enter: () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
      },
      leave: () => {
        inFlight -= 1;
      },
    };
    try {
      const changed = rows.map((row) => row.replace("@example.com", "@changed.example.com"));
      await request(app.getHttpServer())
        .post("/recipients/import")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from(header + changed.join("\n") + "\n"), "contacts.csv")
        .expect(201);
    } finally {
      watchRecipientUpdate = null;
    }

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(8);
  });

  /**
   * One failed row must not abandon the rest. The creates have already
   * committed by this point, so a rejection here leaves the customer with a 500
   * and a half-applied import — the shape of finding 9, which the CRM path has
   * caught per-row since ADR 0186. See ADR 0215.
   */
  it("finishes a CSV import when one row's email update fails", async () => {
    const { token } = await signUp();
    const header = "firstName,lastName,postcode,email\n";
    const rows = [0, 1, 2].map((i) => `Fail${i},Contact,SW2A ${i}AA,fail${i}@example.com`);
    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(header + rows.join("\n") + "\n"), "contacts.csv")
      .expect(201);

    // Re-upload with new emails so every row is an update, and break one.
    failRecipientUpdates = 1;
    try {
      const changed = rows.map((row) => row.replace("@example.com", "@changed.test"));
      const res = await request(app.getHttpServer())
        .post("/recipients/import")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from(header + changed.join("\n") + "\n"), "contacts.csv")
        .expect(201);

      const body = res.body as { warnings: { row: number; message: string }[] };
      // The import completes and names the row whose email didn't refresh.
      expect(body.warnings.some((w) => /email couldn't be updated/i.test(w.message))).toBe(true);
    } finally {
      failRecipientUpdates = null;
    }

    // And the other two did refresh — the failure was isolated, not fatal.
    const listed = await request(app.getHttpServer())
      .get("/recipients?perPage=50")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const emails = (listed.body as { items: { email: string | null }[] }).items.map((i) => i.email);
    expect(emails.filter((e) => e?.endsWith("@changed.test"))).toHaveLength(2);
  });

  it("does not count a duplicate row within the file as an updated contact", async () => {
    // Two rows for the same person in one file. The second is merged into the
    // first — nothing existing was changed, so reporting it as "updated 1"
    // tells the customer a contact was edited when none was. It is a duplicate,
    // and the row it duplicates is the useful thing to say.
    const { token } = await signUp();
    const csv =
      "firstName,lastName,postcode\n" +
      "Twice,Listed,SW1A 1AA\n" +
      "Twice,Listed,SW1A 1AA\n" +
      "Once,Listed,SW1A 2AA\n";
    const response = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "contacts.csv")
      .expect(201);
    const summary = importSummarySchema.parse(response.body);

    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.warnings.some((w) => w.row === 3 && /duplicate/i.test(w.message))).toBe(true);
  });

  it("reports the contacts it actually created, not the ones it tried to", async () => {
    // `skipDuplicates` is on the import's createMany for a documented reason:
    // another request can create a contact matching this batch's dedupe key
    // between the lookup and the insert. When it does, the insert is silently
    // short — and reporting `accepted.length` claims a contact that is not
    // there. ingestFromSource reads `result.count`; the CSV path did not.
    const { token, accountId } = await signUp();
    raceBeforeCreateMany = async () => {
      await prisma.recipient.create({
        data: {
          accountId,
          source: "api",
          firstName: "Raced",
          lastName: "In",
          addressPostcode: "SW1A 1AA",
          // The dedupe key includes the DOB, and Postgres treats NULLs as
          // distinct — so a collision needs every part of the key present.
          dateOfBirth: new Date("2015-03-04T00:00:00.000Z"),
        },
      });
    };

    const csv =
      "firstName,lastName,postcode,dateOfBirth\n" +
      "Raced,In,SW1A 1AA,04/03/2015\n" +
      "Genuinely,New,SW1A 2AA,05/06/2016\n";
    const response = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "contacts.csv")
      .expect(201);
    const summary = importSummarySchema.parse(response.body);

    // Three contacts exist: the raced one, and the one genuinely new row. The
    // import created one of them, and the count must say one.
    expect(await prisma.recipient.count({ where: { accountId } })).toBe(2);
    expect(summary.created).toBe(1);
  });

  it("imports contacts whose birthdays aren't dd/mm/yyyy instead of rejecting the whole file", async () => {
    // The reported bug: a CSV whose date-of-birth column is a common non-UK
    // format (here ISO yyyy-mm-dd, plus one unparseable value) had EVERY row
    // rejected, so the whole import silently failed. Now the rows import — the
    // DOB is parsed when recognised, dropped-with-a-warning when not.
    const { token } = await signUp();
    const csv =
      "firstName,lastName,dateOfBirth\n" +
      "Iso,Contact,1990-05-01\n" +
      "Another,Contact,1985-12-24\n" +
      "Unparseable,Dob,May the 4th\n";
    const response = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "contacts.csv")
      .expect(201);
    const summary = importSummarySchema.parse(response.body);
    // All three import; none rejected.
    expect(summary.created).toBe(3);
    expect(summary.rejected).toHaveLength(0);
    // Only the unparseable DOB produces a warning.
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]?.message).toMatch(/date of birth/i);

    const list = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const items = paginatedRecipientsSchema.parse(list.body).items;
    expect(items).toHaveLength(3);
    // The ISO birthday was understood and stored.
    const iso = items.find((r) => r.firstName === "Iso");
    expect(iso?.dateOfBirth).not.toBeNull();
    // The unparseable one imported without a DOB rather than being dropped.
    const bad = items.find((r) => r.firstName === "Unparseable");
    expect(bad).toBeDefined();
    expect(bad?.dateOfBirth).toBeNull();
  });

  it("previews a CSV: reports columns, row count, and an auto-detected mapping", async () => {
    const { token } = await signUp();
    const csv =
      "First Name,Surname,DOB,Post Code,Email Address\n" +
      "Ada,Lovelace,10/12/1815,SW1A 1AA,ada@example.com\n";
    const response = await request(app.getHttpServer())
      .post("/recipients/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "contacts.csv")
      .expect(201);
    const preview = csvImportPreviewSchema.parse(response.body);
    expect(preview.columns).toEqual(["First Name", "Surname", "DOB", "Post Code", "Email Address"]);
    expect(preview.totalRows).toBe(1);
    expect(preview.sampleRows[0]).toMatchObject({ "First Name": "Ada", Surname: "Lovelace" });
    expect(preview.suggestedMapping).toMatchObject({
      firstName: "First Name",
      lastName: "Surname",
      dateOfBirth: "DOB",
      postcode: "Post Code",
      email: "Email Address",
    });
  });

  it("imports a CSV whose headers don't match ours, using a column mapping", async () => {
    const { token } = await signUp();
    const csv =
      "First Name,Surname,House,City,Post Code\n" + "Grace,Hopper,3 Navy Lane,Bristol,BS1 1AA\n";
    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .field(
        "mapping",
        JSON.stringify({
          firstName: "First Name",
          lastName: "Surname",
          addressLine1: "House",
          addressCity: "City",
          postcode: "Post Code",
        }),
      )
      .attach("file", Buffer.from(csv), "contacts.csv")
      .expect(201);

    const list = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const item = paginatedRecipientsSchema.parse(list.body).items[0];
    expect(item).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      addressLine1: "3 Navy Lane",
      addressCity: "Bristol",
      addressPostcode: "BS1 1AA",
    });
  });

  it("searches by name and sorts the contacts table", async () => {
    const { token } = await signUp();
    const add = (firstName: string, lastName: string) =>
      request(app.getHttpServer())
        .post("/recipients")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName, lastName, ...MAILABLE })
        .expect(201);
    await add("Zoe", "Adams");
    await add("Amy", "Baker");
    await add("Bob", "Adams");

    // Search matches first or last name, case-insensitive.
    const searched = await request(app.getHttpServer())
      .get("/recipients?search=adams")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const searchList = paginatedRecipientsSchema.parse(searched.body);
    expect(searchList.total).toBe(2);
    expect(searchList.items.every((r) => r.lastName === "Adams")).toBe(true);

    // Sort by name ascending: lastName then firstName.
    const sorted = await request(app.getHttpServer())
      .get("/recipients?sort=name_asc")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const names = paginatedRecipientsSchema
      .parse(sorted.body)
      .items.map((r) => `${r.lastName} ${r.firstName}`);
    expect(names).toEqual(["Adams Bob", "Adams Zoe", "Baker Amy"]);
  });

  it("schedules a birthday event on the calendar the moment a recipient with a DOB is added", async () => {
    const { token } = await signUp();

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      // A December birthday is well outside the 21-day approval window, so it
      // stays `scheduled` (a calendar marker) rather than being promoted.
      .send({ firstName: "Birthday", lastName: "Child", dateOfBirth: "2015-12-25", ...MAILABLE })
      .expect(201);

    const occasions = await request(app.getHttpServer())
      .get("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const birthday = occasionListSchema
      .parse(occasions.body)
      .items.find((o) => o.type === "birthday");
    expect(birthday).toBeDefined();
    expect(birthday?.status).toBe("scheduled");
    expect(birthday?.occasionDate.slice(5, 10)).toBe("12-25");
  });

  it("does not schedule a birthday for a recipient with no DOB", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "No", lastName: "Birthday", ...MAILABLE })
      .expect(201);

    const occasions = await request(app.getHttpServer())
      .get("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasionListSchema.parse(occasions.body).items).toHaveLength(0);
  });

  it("schedules birthday events for CSV-imported recipients too", async () => {
    const { token } = await signUp();
    const csv = [
      "firstName,lastName,dateOfBirth,postcode,email",
      "Imported,Pupil,25/12/2016,SW1A 2AA,pupil@example.com",
    ].join("\n");

    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);

    const occasions = await request(app.getHttpServer())
      .get("/occasions?type=birthday")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const items = occasionListSchema.parse(occasions.body).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("scheduled");
  });

  it("re-points the scheduled birthday when a recipient's DOB changes", async () => {
    const { token } = await signUp();
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "Change",
            lastName: "OfBirthday",
            dateOfBirth: "2015-12-25",
            ...MAILABLE,
          })
          .expect(201)
      ).body,
    );

    await request(app.getHttpServer())
      .patch(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "2015-11-10" })
      .expect(200);

    const occasions = await request(app.getHttpServer())
      .get("/occasions?type=birthday")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const items = occasionListSchema.parse(occasions.body).items;
    // Exactly one scheduled birthday, now pointing at the new date.
    expect(items).toHaveLength(1);
    expect(items[0]?.occasionDate.slice(5, 10)).toBe("11-10");
  });

  it("clears a date of birth and email when sent as null, and retires the birthday", async () => {
    const { token } = await signUp();
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "Wrongly",
            lastName: "Dated",
            dateOfBirth: "2015-12-25",
            email: "wrong@example.com",
            ...MAILABLE,
          })
          .expect(201)
      ).body,
    );

    // A contact imported with a US-order date mix-up: the fix is to clear the
    // field, not to guess a replacement. Clearing has to reach the column *and*
    // take the birthday with it — a date of birth is what schedules the card,
    // so a stale birthday keeps generating one, paid from the wallet on an
    // auto-send account.
    const updated = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .patch(`/recipients/${created.id}`)
          .set("Authorization", `Bearer ${token}`)
          .send({ dateOfBirth: null, email: null })
          .expect(200)
      ).body,
    );
    expect(updated.dateOfBirth).toBeNull();
    expect(updated.email).toBeNull();

    const occasions = await request(app.getHttpServer())
      .get("/occasions?type=birthday")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasionListSchema.parse(occasions.body).items).toHaveLength(0);
  });

  it("edits a recipient's details", async () => {
    const { token } = await signUp();
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Edit", lastName: "Me", ...MAILABLE })
          .expect(201)
      ).body,
    );

    const updated = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .patch(`/recipients/${created.id}`)
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Edited", email: "edited@example.com", addressPostcode: "SW1A 1AA" })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({
      firstName: "Edited",
      lastName: "Me",
      email: "edited@example.com",
      addressPostcode: "SW1A 1AA",
    });
  });

  it("persists custom fields on create and merges them on update", async () => {
    const { token } = await signUp();
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "Field",
            lastName: "Test",
            customFields: { teacher: "Mrs Patel" },
            ...MAILABLE,
          })
          .expect(201)
      ).body,
    );
    expect(created.customFields).toEqual({ teacher: "Mrs Patel" });

    const updated = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .patch(`/recipients/${created.id}`)
          .set("Authorization", `Bearer ${token}`)
          .send({ customFields: { teacher: "Mr Okafor", house: "Blue" } })
          .expect(200)
      ).body,
    );
    expect(updated.customFields).toEqual({ teacher: "Mr Okafor", house: "Blue" });
  });

  it("archives a recipient via DELETE and restores it via PATCH status", async () => {
    const { token } = await signUp();
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Archive", lastName: "Restore", ...MAILABLE })
          .expect(201)
      ).body,
    );

    const archived = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .delete(`/recipients/${created.id}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(archived.status).toBe("archived");

    const restored = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .patch(`/recipients/${created.id}`)
          .set("Authorization", `Bearer ${token}`)
          .send({ status: "active" })
          .expect(200)
      ).body,
    );
    expect(restored.status).toBe("active");
  });

  it("keeps archived recipients out of the default list but returns them under ?status=archived", async () => {
    const { token } = await signUp();
    const active = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Stays", lastName: "Visible", ...MAILABLE })
          .expect(201)
      ).body,
    );
    const toArchive = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Goes", lastName: "ToFolder", ...MAILABLE })
          .expect(201)
      ).body,
    );
    await request(app.getHttpServer())
      .delete(`/recipients/${toArchive.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // Default list: the active one shows, the archived one is out of sight.
    const defaultList = paginatedRecipientsSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/recipients?page=1&perPage=100")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    const defaultIds = defaultList.items.map((r) => r.id);
    expect(defaultIds).toContain(active.id);
    expect(defaultIds).not.toContain(toArchive.id);

    // The archived "folder": only the archived recipient.
    const archivedFolder = paginatedRecipientsSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/recipients?page=1&perPage=100&status=archived")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    const archivedIds = archivedFolder.items.map((r) => r.id);
    expect(archivedIds).toContain(toArchive.id);
    expect(archivedIds).not.toContain(active.id);
  });

  it("hides an archived recipient's events from the calendar but keeps them on the recipient's own view", async () => {
    const { token } = await signUp();
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "Hidden",
            lastName: "WhenArchived",
            dateOfBirth: "2015-12-25",
            ...MAILABLE,
          })
          .expect(201)
      ).body,
    );

    // Calendar (account-wide) shows the birthday while active…
    const beforeArchive = await request(app.getHttpServer())
      .get("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasionListSchema.parse(beforeArchive.body).items).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // …hidden from the account-wide calendar once archived…
    const calendar = await request(app.getHttpServer())
      .get("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasionListSchema.parse(calendar.body).items).toHaveLength(0);

    // …but still visible on the recipient's own detail view (so it can be managed).
    const detail = await request(app.getHttpServer())
      .get(`/occasions?recipientId=${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasionListSchema.parse(detail.body).items).toHaveLength(1);

    // Restoring brings it back to the calendar.
    await request(app.getHttpServer())
      .patch(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "active" })
      .expect(200);
    const afterRestore = await request(app.getHttpServer())
      .get("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasionListSchema.parse(afterRestore.body).items).toHaveLength(1);
  });

  it("accepts page and perPage as query-string params (the web always sends them)", async () => {
    const { token } = await signUp();
    const response = await request(app.getHttpServer())
      .get("/recipients?page=1&perPage=100")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(response.body);
    expect(list.perPage).toBe(100);
  });

  it("rejects a duplicate recipient (same name + postcode + DOB)", async () => {
    const { token } = await signUp();
    const payload = {
      firstName: "Sophia",
      lastName: "Johnstone",
      dateOfBirth: "2020-05-14",
      addressLine1: "1 Test Street",
      addressCity: "London",
      addressPostcode: "SW1A 2AA",
    };

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)
      .expect(201);

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)
      .expect(409);
  });

  it("rejects an invalid postcode", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Bad",
        lastName: "Postcode",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "NOTAPOSTCODE",
      })
      .expect(400);
  });

  it("saves a manually-added contact with no address and flags it as needing one", async () => {
    const { token } = await signUp();
    // Name only — no address at all. Accepted (the address is optional; sending a
    // card to this contact is what's blocked, at send time). See docs/adr/0067.
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "No", lastName: "Address" })
          .expect(201)
      ).body,
    );
    expect(created.addressPostcode).toBeNull();

    // It surfaces under the "needs address" worklist filter.
    const flagged = await request(app.getHttpServer())
      .get("/recipients?missingAddress=true")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(flagged.body);
    expect(list.items.map((r) => r.id)).toContain(created.id);
  });

  it("still saves a contact given a partial address (postcode only) and flags it", async () => {
    const { token } = await signUp();
    // A valid postcode but no line 1 / city — accepted, still not mailable.
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Partial", lastName: "Address", addressPostcode: "SW1A 1AA" })
      .expect(201);
    const flagged = await request(app.getHttpServer())
      .get("/recipients?missingAddress=true")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(paginatedRecipientsSchema.parse(flagged.body).total).toBe(1);
  });

  it("scopes recipients to the account — one account cannot see another's data", async () => {
    const accountA = await signUp();
    const accountB = await signUp();

    const createResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${accountA.token}`)
      .send({ firstName: "Private", lastName: "ToAccountA", ...MAILABLE })
      .expect(201);
    const created = recipientSchema.parse(createResponse.body);

    await request(app.getHttpServer())
      .get(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${accountB.token}`)
      .expect(404);

    const listForB = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${accountB.token}`)
      .expect(200);
    expect(paginatedRecipientsSchema.parse(listForB.body).total).toBe(0);
  });

  it("archives a recipient", async () => {
    const { token } = await signUp();
    const createResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "To", lastName: "Archive", ...MAILABLE })
      .expect(201);
    const created = recipientSchema.parse(createResponse.body);

    const archiveResponse = await request(app.getHttpServer())
      .delete(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(recipientSchema.parse(archiveResponse.body).status).toBe("archived");
  });

  it("enforces the plan's recipient cap", async () => {
    // This mutates the *global* free-plan entitlement row (not account-scoped),
    // so any other e2e spec file creating recipients on the free plan while
    // this window is open would see the same cap-of-1 — see the maxWorkers: 1
    // note in jest-e2e.json for why e2e spec files must run serially.
    const { token, accountId } = await signUp();
    await prisma.planEntitlement.update({
      where: { planId: "free" },
      data: { recipientCap: 1 },
    });

    try {
      await request(app.getHttpServer())
        .post("/recipients")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "First", lastName: "Recipient", ...MAILABLE })
        .expect(201);

      await request(app.getHttpServer())
        .post("/recipients")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "Second", lastName: "Recipient", ...MAILABLE })
        .expect(403);
    } finally {
      await prisma.planEntitlement.update({
        where: { planId: "free" },
        data: { recipientCap: 50 },
      });
    }

    const count = await prisma.recipient.count({ where: { accountId } });
    expect(count).toBe(1);
  });

  it("imports a CSV: creates new rows, updates existing ones, and warns on a malformed optional field", async () => {
    const { token } = await signUp();

    // Pre-existing recipient that the CSV should update, not duplicate.
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Archie",
        lastName: "Winn",
        dateOfBirth: "2011-05-29",
        ...MAILABLE,
      })
      .expect(201);

    const csv = [
      "firstName,lastName,dateOfBirth,postcode,email",
      "Sophia,Johnstone,14/05/2020,SW1A 2AA,sophia@example.com",
      "WarnRow,DodgyDob,not-a-date,SW1A 4AA,",
      "Archie,Winn,29/05/2011,SW1A 1AA,updated@example.com",
    ].join("\n");

    const importResponse = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);
    const summary = importSummarySchema.parse(importResponse.body);

    // Sophia + WarnRow are created; Archie is updated. The unparseable DOB no
    // longer rejects its row — it imports with the DOB dropped and a warning.
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(1);
    expect(summary.rejected).toHaveLength(0);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]?.message).toMatch(/date of birth/i);

    const listResponse = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(listResponse.body);
    expect(list.total).toBe(3);

    const archie = list.items.find((r) => r.lastName === "Winn");
    expect(archie?.email).toBe("updated@example.com");
    // The warned row still imported, just without its date of birth.
    const warnRow = list.items.find((r) => r.lastName === "DodgyDob");
    expect(warnRow).toBeDefined();
    expect(warnRow?.dateOfBirth).toBeNull();
  });

  it("does not merge two different recipients that share a name but have no postcode or DOB on file", async () => {
    const { token } = await signUp();

    const csv = [
      "firstName,lastName,dateOfBirth,postcode,email",
      "Jamie,Smith,,,jamie1@example.com",
      "Jamie,Smith,,,jamie2@example.com",
    ].join("\n");

    const importResponse = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);
    const summary = importSummarySchema.parse(importResponse.body);

    // Both rows are new recipients — with no postcode/DOB to distinguish them,
    // they must never be treated as the same person and silently merged.
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(0);

    const listResponse = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(listResponse.body);
    const smiths = list.items.filter((r) => r.lastName === "Smith");
    expect(smiths).toHaveLength(2);
    expect(smiths.map((r) => r.email).sort()).toEqual(["jamie1@example.com", "jamie2@example.com"]);
  });

  it("rejects a structurally malformed CSV with a 400 instead of crashing the whole import", async () => {
    const { token } = await signUp();

    // Second data row has an extra field vs. the header — a mismatched column
    // count, which csv-parse throws on synchronously if not caught.
    const csv = [
      "firstName,lastName,postcode",
      "Good,Row,SW1A 1AA",
      "Bad,Row,SW1A 2AA,extra,columns",
    ].join("\n");

    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(400);
  });

  it("rejects an import request with no file attached", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });

  it("imports a contact with a malformed email, dropping the email with a warning", async () => {
    const { token } = await signUp();
    const csv = ["firstName,lastName,email", "Bad,Email,a@b@example.com"].join("\n");

    const importResponse = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);
    const summary = importSummarySchema.parse(importResponse.body);

    // The contact still imports (its name is valid); only the bad email is
    // dropped, with a warning — never a silent whole-row rejection.
    expect(summary.created).toBe(1);
    expect(summary.rejected).toHaveLength(0);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]?.message).toMatch(/email/i);

    const list = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(paginatedRecipientsSchema.parse(list.body).items[0]?.email).toBeNull();
  });

  it("rejects two concurrent creates that would both push the account over its cap", async () => {
    const { token, accountId } = await signUp();
    await prisma.planEntitlement.update({
      where: { planId: "free" },
      data: { recipientCap: 1 },
    });

    try {
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Racer", lastName: "One", ...MAILABLE }),
        request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Racer", lastName: "Two", ...MAILABLE }),
      ]);

      const statuses = [first.status, second.status].sort();

      // The guarantee is that the cap holds, not which rejection the loser
      // gets. Usually the second request loses the cap check and gets a 403;
      // under enough contention the serializable retry budget is exhausted
      // first and it gets a 503 with Retry-After instead. Both are correct —
      // one create, one refusal — and pinning 403 made this fail on a loaded
      // CI runner while the behaviour was right.
      expect(statuses[0]).toBe(201);
      expect([403, 503]).toContain(statuses[1]);

      // The invariant itself, checked directly rather than inferred from a
      // status code: the account is on a cap of 1 and holds exactly one.
      const stored = await prisma.recipient.count({ where: { accountId } });
      expect(stored).toBe(1);
    } finally {
      await prisma.planEntitlement.update({
        where: { planId: "free" },
        data: { recipientCap: 50 },
      });
    }
  });
});
