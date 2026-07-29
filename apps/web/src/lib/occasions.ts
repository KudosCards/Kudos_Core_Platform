export const OCCASION_TYPE_LABELS: Record<string, string> = {
  birthday: "Birthday",
  achievement: "Achievement",
  leaver: "Leaver",
  staff_recognition: "Staff recognition",
  seasonal: "Seasonal",
  bespoke_campaign: "Bespoke campaign",
};

/** Card-centric labels for an occasion's lifecycle (calendar pop-up, etc.) —
 * phrased around what's happening to the card, not an abstract "status", so a
 * subscriber can tell at a glance whether a card is scheduled, on its way, or
 * already sent. */
export const OCCASION_STATUS_LABELS: Record<string, string> = {
  scheduled: "Card scheduled",
  pending_approval: "Awaiting your approval",
  approved: "Ready to send",
  queued: "Card ordered",
  printed: "Printing",
  posted: "Card sent",
  delivered: "Card delivered",
  skipped: "Skipped",
};

/** Statuses where a card is already ordered/in production/sent — offering
 * "Send a card" again from the calendar would risk a duplicate. */
export const OCCASION_CARD_IN_FLIGHT: ReadonlySet<string> = new Set([
  "queued",
  "printed",
  "posted",
  "delivered",
]);

export function formatOccasionDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
