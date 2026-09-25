import { Injectable, Logger } from "@nestjs/common";
import type { EmailSuppression } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { meaningOfBrevoEvent } from "./brevo-event";

/** Written into `clearedBy` when Brevo's own delivery cleared the suppression. */
export const CLEARED_BY_DELIVERY = "brevo-delivered";

/**
 * A Brevo transactional-webhook payload, taken loosely on purpose.
 *
 * Only `event` and `email` are required, because they are the only fields the
 * decision needs. Everything else is decoration for the humans reading it later
 * and is optional — a webhook that 400s because Brevo added a field is a
 * webhook that stops recording suppressions, which is worse than any field we
 * might miss. Unknown keys are dropped by Zod rather than rejected.
 */
const brevoEventSchema = z.object({
  event: z.string().trim().min(1),
  email: z.string().trim().min(1),
  /** Brevo's own explanation, e.g. "unknown user". */
  reason: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  "message-id": z.string().trim().min(1).optional(),
  /** Epoch timestamps. See `eventTime` for why `date` is not among them. */
  ts_event: z.number().optional(),
  ts: z.number().optional(),
});

export type BrevoWebhookEvent = z.infer<typeof brevoEventSchema>;

/** What `record` did, so the caller can log it without re-deriving it. */
export type SuppressionOutcome = "suppressed" | "cleared" | "ignored" | "unparsable";

/**
 * The addresses Brevo has told us it will not deliver to.
 *
 * Brevo accepts our API call for a blocklisted address, hands back a message
 * id and drops the message. Nothing appears in its delivery log, so from inside
 * the product a suppressed send is indistinguishable from a delivered one. This
 * service is the only writer of that knowledge, fed by Brevo's webhook.
 */
@Injectable()
export class EmailSuppressionService {
  private readonly logger = new Logger(EmailSuppressionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one webhook event. Never throws for bad input: a webhook sender that
   * gets a 500 retries, and retrying a payload we cannot parse just moves the
   * same failure around. Unusable payloads are logged and swallowed.
   */
  async record(payload: unknown): Promise<SuppressionOutcome> {
    const parsed = brevoEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(`Ignoring a Brevo webhook we couldn't read: ${parsed.error.message}`);
      return "unparsable";
    }

    const event = parsed.data;
    const email = normaliseEmail(event.email);
    if (!email) {
      this.logger.warn(`Ignoring a Brevo "${event.event}" event with no usable address`);
      return "unparsable";
    }

    const meaning = meaningOfBrevoEvent(event.event);
    if (meaning.kind === "ignore") return "ignored";

    const occurredAt = eventTime(event);
    if (meaning.kind === "recover") {
      return (await this.clear(email, occurredAt)) ? "cleared" : "ignored";
    }

    const now = new Date();
    await this.prisma.emailSuppression.upsert({
      where: { email },
      create: {
        email,
        reason: meaning.reason,
        detail: event.reason ?? null,
        subject: event.subject ?? null,
        messageId: event["message-id"] ?? null,
        occurredAt,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        reason: meaning.reason,
        detail: event.reason ?? null,
        subject: event.subject ?? null,
        messageId: event["message-id"] ?? null,
        occurredAt,
        lastSeenAt: now,
        // A fresh suppression re-opens a cleared row: the address stopped
        // working again, whoever declared it fixed.
        clearedAt: null,
        clearedBy: null,
      },
    });

    this.logger.warn(
      `Brevo will not deliver to ${email} (${meaning.reason}${event.reason ? `: ${event.reason}` : ""})`,
    );
    return "suppressed";
  }

  /** The live suppression for an address, or null when we can reach it. */
  async find(email: string): Promise<EmailSuppression | null> {
    const normalised = normaliseEmail(email);
    if (!normalised) return null;
    return this.prisma.emailSuppression.findFirst({
      where: { email: normalised, clearedAt: null },
    });
  }

  /**
   * Clear a suppression because Brevo delivered to the address again — proof
   * from the authority itself, which is the only evidence we accept without a
   * human involved.
   *
   * Two guards, both deliberately one-sided. Webhooks arrive out of order, and
   * an old delivery landing after a new bounce would otherwise declare a dead
   * address healthy, putting us straight back into silent failure. Getting it
   * wrong the other way only leaves a stale row that ops can clear by hand. So
   * a delivery with no usable timestamp clears nothing, and a delivery older
   * than the event that suppressed the address clears nothing.
   *
   * The comparison lives in the `where` clause so the read and the write are
   * one statement, and two events racing cannot both pass a check that only one
   * of them should.
   */
  private async clear(email: string, deliveredAt: Date | null): Promise<boolean> {
    if (!deliveredAt) return false;
    const { count } = await this.prisma.emailSuppression.updateMany({
      where: {
        email,
        clearedAt: null,
        OR: [
          { occurredAt: { lte: deliveredAt } },
          { AND: [{ occurredAt: null }, { lastSeenAt: { lte: deliveredAt } }] },
        ],
      },
      data: { clearedAt: new Date(), clearedBy: CLEARED_BY_DELIVERY },
    });
    if (count > 0) this.logger.log(`Brevo delivered to ${email} again — suppression cleared`);
    return count > 0;
  }
}

/**
 * Lowercased and trimmed, or null when it couldn't be an address at all.
 *
 * Brevo matches addresses case-insensitively. If we didn't, `Bob@x.com` would
 * read as deliverable while Brevo blocks `bob@x.com` — the lookup would miss
 * exactly the address it was asked about.
 */
function normaliseEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

/**
 * When Brevo says the event happened, or null.
 *
 * `ts_event` is preferred over `ts` because it is the time of the event rather
 * than of the message. Brevo's `date` field is deliberately unused: it arrives
 * as `"2020-10-09 00:00:00"` with no timezone, so reading it would silently
 * misplace events by up to a day, and a wrong timestamp here decides whether a
 * later delivery is allowed to clear a suppression.
 *
 * Brevo's docs describe its epoch fields as seconds in one place and
 * milliseconds in another, and its own sample payload shows seconds. Rather
 * than pick, anything large enough to be milliseconds is treated as such —
 * seconds-since-epoch will not reach 1e12 until the year 33658.
 */
function eventTime(event: BrevoWebhookEvent): Date | null {
  const raw = event.ts_event ?? event.ts;
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return null;
  const millis = raw > 1e12 ? raw : raw * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}
