import type { Prisma } from "@prisma/client";
import { computeDispatchDate } from "./occasion-scheduling.constants";
import { nextBirthdayOccurrence } from "./next-birthday.util";

/** The minimal key-date shape needed to schedule its recurring occasion. */
export interface KeyDateOccasionInput {
  accountId: string;
  recipientId: string;
  /** A KeyDateType value — also a valid OccasionType ("renewal" | "anniversary"). */
  type: "renewal" | "anniversary";
  /** The anchor date; only its month/day drive the annual recurrence. */
  date: Date;
  /** Optional human label → the occasion's title (e.g. "Membership renewal"). */
  label?: string | null;
}

/**
 * Builds the `scheduled` occasion for a recipient's *next* renewal/anniversary,
 * the direct analogue of `buildScheduledBirthdayOccasion` — same annual
 * month/day recurrence (via `nextBirthdayOccurrence`), same working-days dispatch
 * timing, same `scheduled` start so it sits on the calendar until the scheduler
 * promotes it into the approval window. Inserted with `skipDuplicates` against the
 * occasion_idempotency_key (recipientId, type, occasionDate).
 * See docs/adr/0104-recurring-key-dates.md.
 */
export function buildScheduledKeyDateOccasion(
  input: KeyDateOccasionInput,
  today: Date,
): Prisma.OccasionCreateManyInput {
  const occasionDate = nextBirthdayOccurrence(input.date, today);
  return {
    accountId: input.accountId,
    recipientId: input.recipientId,
    type: input.type,
    source: "recurring_per_recipient",
    ...(input.label ? { title: input.label } : {}),
    occasionDate,
    dispatchDate: computeDispatchDate(occasionDate),
    status: "scheduled",
  };
}
