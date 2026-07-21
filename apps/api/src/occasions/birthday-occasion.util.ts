import type { Prisma } from "@prisma/client";
import { computeDispatchDate } from "./occasion-scheduling.constants";
import { nextBirthdayOccurrence } from "./next-birthday.util";

/** The minimal recipient shape needed to schedule a birthday occasion. */
export interface BirthdayRecipient {
  id: string;
  accountId: string;
  dateOfBirth: Date;
}

/** Midnight-UTC start of the given day (birthday maths is all date-only). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Builds the `scheduled` birthday occasion for a recipient's *next* birthday.
 *
 * `scheduled` (not `pending_approval`) is deliberate: a birthday can be months
 * away, and we want it on the calendar as a "first scheduled event" the moment
 * a recipient is added — but not cluttering the approvals queue until it's
 * actually close enough to act on. The birthday scheduler cron promotes it to
 * `pending_approval` once it enters the lookahead window (see
 * occasion-scheduler.service.ts). Rows are inserted with `skipDuplicates`, so
 * the occasion_idempotency_key (recipientId, type, occasionDate) makes creating
 * one idempotent no matter how many code paths call this.
 * See docs/adr/0016-recipient-events-and-lists.md.
 */
export function buildScheduledBirthdayOccasion(
  recipient: BirthdayRecipient,
  today: Date,
): Prisma.OccasionCreateManyInput {
  const occasionDate = nextBirthdayOccurrence(recipient.dateOfBirth, today);
  return {
    accountId: recipient.accountId,
    recipientId: recipient.id,
    type: "birthday",
    source: "recurring_per_recipient",
    occasionDate,
    dispatchDate: computeDispatchDate(occasionDate),
    status: "scheduled",
  };
}
