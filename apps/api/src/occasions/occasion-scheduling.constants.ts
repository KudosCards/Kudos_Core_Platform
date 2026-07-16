/**
 * Shared by both manual creation (occasions.service.ts) and the birthday
 * auto-scheduler (occasion-scheduler.service.ts) — see
 * docs/adr/0006-phase-2-scope.md for why these are hardcoded defaults
 * rather than env vars or account settings.
 */

/** How many days ahead of dispatch a birthday occasion is created. */
export const BIRTHDAY_LOOKAHEAD_DAYS = 21;

/** Default gap between occasionDate and dispatchDate, before real postage-class timing exists. */
export const DEFAULT_POSTAGE_LEAD_DAYS = 5;

export function computeDispatchDate(occasionDate: Date): Date {
  const dispatchDate = new Date(occasionDate);
  dispatchDate.setUTCDate(dispatchDate.getUTCDate() - DEFAULT_POSTAGE_LEAD_DAYS);
  return dispatchDate;
}
