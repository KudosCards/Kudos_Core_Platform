import { createHash, timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Public } from "../auth/public.decorator";
import type { EnvConfig } from "../config/env.schema";
import { EmailSuppressionService } from "./email-suppression.service";

/** Header carrying the shared secret, when Brevo is configured to send one. */
export const BREVO_SECRET_HEADER = "x-brevo-webhook-secret";

/**
 * Where Brevo tells us an address stopped working.
 *
 * ## Why a shared secret and not a signature
 *
 * Stripe signs its webhooks, so `/webhooks/stripe` can verify that a request
 * genuinely came from Stripe. Brevo does not sign anything — its transactional
 * webhooks arrive as plain POSTs with no HMAC and no verifiable origin. The
 * only thing we can check is a secret we chose ourselves and gave to Brevo.
 *
 * It is accepted in a header *or* a query parameter because Brevo's dashboard
 * has not always allowed custom headers on a webhook. Where it does, the header
 * is the better form; where it doesn't, the URL itself is the credential and
 * must be treated as one — it will sit in Brevo's configuration and in their
 * request logs.
 *
 * Without the secret an attacker could forge suppressions and, once E2 lands,
 * make the product believe it cannot email a customer it can reach perfectly
 * well.
 */
@Controller("webhooks")
export class BrevoWebhookController {
  private readonly logger = new Logger(BrevoWebhookController.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly suppressions: EmailSuppressionService,
  ) {}

  @Public()
  @Post("brevo")
  // 200 rather than Nest's default 201 for a POST. Brevo treats any 2xx as
  // delivered, but a webhook endpoint claiming it *created* something is a lie
  // that costs nothing to avoid.
  @HttpCode(HttpStatus.OK)
  async handleBrevoEvent(
    // Typed `unknown`, not a DTO class, and that is load-bearing: the global
    // ValidationPipe runs with `forbidNonWhitelisted`, so a DTO would 400 the
    // moment Brevo added a field to its payload — silently switching the
    // webhook off. Shape-checking happens in the service, which is tolerant by
    // design.
    @Body() body: unknown,
    @Headers(BREVO_SECRET_HEADER) headerSecret?: string,
    @Query("secret") querySecret?: string,
  ): Promise<{ received: true }> {
    this.assertAuthentic(headerSecret || querySecret);

    // Brevo sends one event per request today, but has batched in the past and
    // nothing promises it won't again.
    const events = Array.isArray(body) ? body : [body];
    for (const event of events) {
      await this.suppressions.record(event);
    }
    return { received: true };
  }

  private assertAuthentic(provided: string | undefined): void {
    const expected = this.config.get("BREVO_WEBHOOK_SECRET", { infer: true });

    // Unset means nobody has wired this deployment up. Say that, rather than
    // 401ing (which reads as "wrong secret" and sends someone hunting for a
    // typo) or accepting the write (which would let anyone on the internet
    // decide who we can email).
    if (!expected) {
      this.logger.error("Rejected a Brevo webhook — BREVO_WEBHOOK_SECRET is not set");
      throw new ServiceUnavailableException("Brevo webhook is not configured");
    }

    if (!provided || !secretMatches(provided, expected)) {
      throw new UnauthorizedException("Invalid Brevo webhook secret");
    }
  }
}

/**
 * Constant-time secret comparison.
 *
 * Compares SHA-256 digests rather than raw strings. `timingSafeEqual` throws
 * when its arguments differ in length, so comparing raw bytes needs a length
 * guard first — and that guard returns early, which both leaks the secret's
 * length and makes the "constant time" claim untrue in the case it matters in.
 * Digests are always 32 bytes, so every comparison does identical work whatever
 * was sent. Same reasoning as the catalog revalidate route.
 */
function secretMatches(provided: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
