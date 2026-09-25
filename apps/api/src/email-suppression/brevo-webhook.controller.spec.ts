import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import { BrevoWebhookController } from "./brevo-webhook.controller";
import type { EmailSuppressionService } from "./email-suppression.service";

const configReturning = (secret: string | undefined): ConfigService<EnvConfig, true> =>
  ({ get: () => secret }) as unknown as ConfigService<EnvConfig, true>;

describe("BrevoWebhookController", () => {
  const record = jest.fn().mockResolvedValue("suppressed");
  const suppressions = { record } as unknown as EmailSuppressionService;

  beforeEach(() => record.mockClear());

  // Unset reads as "nobody wired this deployment up". A 401 would read as
  // "wrong secret" and send someone hunting for a typo that isn't there.
  it("refuses with 503 when no secret is configured, whatever was sent", async () => {
    const controller = new BrevoWebhookController(configReturning(undefined), suppressions);

    await expect(controller.handleBrevoEvent({}, "anything")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses with 401 when the secret is wrong or missing", async () => {
    const controller = new BrevoWebhookController(configReturning("right"), suppressions);

    await expect(controller.handleBrevoEvent({}, "wrong")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.handleBrevoEvent({})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(record).not.toHaveBeenCalled();
  });

  // A present-but-wrong header must not fall through to the query parameter,
  // which would let anyone bypass the header check by appending to the URL.
  it("does not fall back to the query secret when a header was sent", async () => {
    const controller = new BrevoWebhookController(configReturning("right"), suppressions);

    await expect(
      controller.handleBrevoEvent({}, "wrong", undefined, "right"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Brevo's form takes a single masked value and does not say what header it
  // travels in, so both shapes of Authorization have to be read.
  it("accepts the secret as a bearer token or a bare Authorization value", async () => {
    const controller = new BrevoWebhookController(configReturning("right"), suppressions);

    await expect(controller.handleBrevoEvent({ a: 1 }, undefined, "Bearer right")).resolves.toEqual(
      { received: true },
    );
    await expect(controller.handleBrevoEvent({ a: 2 }, undefined, "bearer right")).resolves.toEqual(
      { received: true },
    );
    await expect(controller.handleBrevoEvent({ a: 3 }, undefined, "right")).resolves.toEqual({
      received: true,
    });
    expect(record).toHaveBeenCalledTimes(3);
  });

  it("refuses a bearer token that is not the secret", async () => {
    const controller = new BrevoWebhookController(configReturning("right"), suppressions);

    await expect(controller.handleBrevoEvent({}, undefined, "Bearer wrong")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(record).not.toHaveBeenCalled();
  });

  // Otherwise the header check could be defeated by appending to the URL.
  it("does not fall back to the query secret when an Authorization header was sent", async () => {
    const controller = new BrevoWebhookController(configReturning("right"), suppressions);

    await expect(
      controller.handleBrevoEvent({}, undefined, "Bearer wrong", "right"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("accepts either carrier of the right secret", async () => {
    const controller = new BrevoWebhookController(configReturning("right"), suppressions);

    await expect(controller.handleBrevoEvent({ a: 1 }, "right")).resolves.toEqual({
      received: true,
    });
    await expect(
      controller.handleBrevoEvent({ a: 2 }, undefined, undefined, "right"),
    ).resolves.toEqual({
      received: true,
    });
    expect(record).toHaveBeenCalledTimes(2);
  });
});
