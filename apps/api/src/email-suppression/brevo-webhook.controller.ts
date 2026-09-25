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
 * Brevo's webhook form offers "Token" authentication: a single masked value,
 * with no way to name the header it travels in. That makes the wire format
 * theirs to choose, so this reads all three carriers a secret could plausibly
 * arrive in — `x-brevo-webhook-secret`, an `Authorization` header with or
 * without a `Bearer` prefix, and a `?secret=` query parameter — rather than
 * betting on one and finding out from an endpoint that silently 401s
 * everything.
 *
 * The header forms are preferable: Brevo masks the Token field, while a secret
 * in the URL sits legible in the webhook's configuration screen and in Brevo's
 * request logs, where anyone with dashboard access can read it. The query form
 * stays supported because it is the one that works whatever the form offers.
 *
 * Only the first carrier actually present is checked. Reading them in turn
 * until one matched would let anyone past the header check by appending to the
 * URL.
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
    @Headers("authorization") authorization?: string,
    @Query("secret") querySecret?: string,
  ): Promise<{ received: true }> {
    this.assertAuthentic(presentedSecret(headerSecret, authorization, querySecret));

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
 * The secret this request carries, from the first carrier that holds anything.
 *
 * "First present" rather than "first that matches": a wrong value in one
 * carrier is a rejection, not an invitation to try the next. Falling through
 * would mean a request could defeat the header check simply by also putting
 * something in the query string.
 */
function presentedSecret(
  header: string | undefined,
  authorization: string | undefined,
  query: string | undefined,
): string | undefined {
  if (header) return header;
  // `Bearer <token>` is the usual shape, but Brevo's form only takes a value
  // and does not say what it wraps it in, so a bare token is accepted too.
  if (authorization) return authorization.replace(/^Bearer\s+/i, "");
  return query || undefined;
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
