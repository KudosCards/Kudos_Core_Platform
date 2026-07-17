import type { PostageClass } from "@prisma/client";

/**
 * Shared by both manual creation (occasions.service.ts) and the birthday
 * auto-scheduler (occasion-scheduler.service.ts) — see
 * docs/adr/0006-phase-2-scope.md for why these are hardcoded defaults
 * rather than env vars or account settings.
 */

/** How many days ahead of dispatch a birthday occasion is created. */
export const BIRTHDAY_LOOKAHEAD_DAYS = 21;

/** Default gap between occasionDate and dispatchDate when no postage class is
 * chosen yet (a fresh occasion, before approval). */
export const DEFAULT_POSTAGE_LEAD_DAYS = 5;

/**
 * How many days before the occasion date a card must be dispatched to arrive in
 * time, per postage class. Covers Kudos HQ print/pack turnaround plus Royal Mail
 * delivery: first class lands sooner (~3 days), second class needs a longer run
 * (~5). The auto-send cron acts once `dispatchDate <= today`. See
 * docs/adr/0013-auto-send.md.
 */
export const POSTAGE_LEAD_DAYS: Record<PostageClass, number> = {
  first_class: 3,
  second_class: 5,
};

/** dispatchDate = occasionDate − lead days (default lead when no class given). */
export function computeDispatchDate(
  occasionDate: Date,
  leadDays: number = DEFAULT_POSTAGE_LEAD_DAYS,
): Date {
  const dispatchDate = new Date(occasionDate);
  dispatchDate.setUTCDate(dispatchDate.getUTCDate() - leadDays);
  return dispatchDate;
}
