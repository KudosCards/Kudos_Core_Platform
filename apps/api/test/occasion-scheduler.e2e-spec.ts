import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { OccasionSchedulerService } from "../src/occasions/occasion-scheduler.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("OccasionSchedulerService (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: OccasionSchedulerService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(OccasionSchedulerService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUpWithRecipient(
    dateOfBirth: string,
  ): Promise<{ accountId: string; recipientId: string }> {
    const token = await mintToken(randomUUID());
    const signupResponse = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(signupResponse.body).id;

    const recipientResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Birthday", lastName: "Person", dateOfBirth })
      .expect(201);
    return { accountId, recipientId: (recipientResponse.body as { id: string }).id };
  }

  it("creates a pending_approval birthday occasion for a recipient whose birthday is within the lookahead window", async () => {
    const inTenDays = new Date();
    inTenDays.setUTCDate(inTenDays.getUTCDate() + 10);
    const dateOfBirth = `2015-${String(inTenDays.getUTCMonth() + 1).padStart(2, "0")}-${String(inTenDays.getUTCDate()).padStart(2, "0")}`;

    const { recipientId } = await signUpWithRecipient(dateOfBirth);

    await scheduler.scheduleBirthdayOccasions();

    const occasions = await prisma.occasion.findMany({ where: { recipientId } });
    expect(occasions).toHaveLength(1);
    expect(occasions[0]).toMatchObject({
      type: "birthday",
      source: "recurring_per_recipient",
      status: "pending_approval",
    });
  });

  it("keeps a far-off birthday on the calendar as `scheduled` without promoting it to the approvals queue", async () => {
    const inNinetyDays = new Date();
    inNinetyDays.setUTCDate(inNinetyDays.getUTCDate() + 90);
    const dateOfBirth = `2015-${String(inNinetyDays.getUTCMonth() + 1).padStart(2, "0")}-${String(inNinetyDays.getUTCDate()).padStart(2, "0")}`;

    const { recipientId } = await signUpWithRecipient(dateOfBirth);

    await scheduler.scheduleBirthdayOccasions();

    // The recipient's birthday is a calendar event from the moment they're added
    // (a `scheduled` occasion), but it stays out of the approvals queue until it
    // enters the lookahead window — so it is present, just not pending_approval.
    const occasions = await prisma.occasion.findMany({ where: { recipientId } });
    expect(occasions).toHaveLength(1);
    expect(occasions[0]).toMatchObject({ type: "birthday", status: "scheduled" });
  });

  it("is idempotent — running twice does not create duplicate occasions", async () => {
    const inFiveDays = new Date();
    inFiveDays.setUTCDate(inFiveDays.getUTCDate() + 5);
    const dateOfBirth = `2015-${String(inFiveDays.getUTCMonth() + 1).padStart(2, "0")}-${String(inFiveDays.getUTCDate()).padStart(2, "0")}`;

    const { recipientId } = await signUpWithRecipient(dateOfBirth);

    await scheduler.scheduleBirthdayOccasions();
    await scheduler.scheduleBirthdayOccasions();

    const occasions = await prisma.occasion.findMany({ where: { recipientId } });
    expect(occasions).toHaveLength(1);
  });
});
