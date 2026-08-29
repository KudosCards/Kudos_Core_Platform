export const OCCASION_TYPE_LABELS: Record<string, string> = {
  birthday: "Birthday",
  renewal: "Renewal",
  anniversary: "Anniversary",
  achievement: "Achievement",
  leaver: "Leaver",
  staff_recognition: "Staff recognition",
  seasonal: "Seasonal",
  bespoke_campaign: "Bespoke campaign",
};

/**
 * The one set of words for an occasion's lifecycle, used by the calendar, the
 * contact timeline and Approvals alike.
 *
 * There used to be two tables. The calendar called a queued card "Card ordered"
 * and a posted one "Card sent"; the contact page called the same two "In
 * fulfilment" and "Posted". Same card, two screens, different words — and a
 * customer moving between them had no way to know they were the same thing.
 *
 * Card-centric on purpose: phrased around what is happening to the card rather
 * than an abstract status, so it reads as an answer to "where is my card?".
 */
export const OCCASION_STATUS_LABELS: Record<string, string> = {
  scheduled: "Card scheduled",
  pending_approval: "Awaiting your approval",
  approved: "Ready to send",
  queued: "Card ordered",
  printed: "Printing",
  posted: "Card sent",
  delivered: "Card delivered",
  skipped: "Skipped",
  missed: "Missed",
};

/** The one line that explains a status where the label alone would leave a
 * question. Shown beside the pill on the contact's timeline. */
export const OCCASION_STATUS_HELP: Record<string, string> = {
  missed: "The date passed and no card was sent.",
  skipped: "You chose not to send a card for this one.",
};

/** Tint for each status pill. Lives here with the labels so the two cannot
 * drift: a status added to one and not the other renders unstyled or unnamed. */
export const OCCASION_STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-foreground/[0.06] text-muted",
  pending_approval: "bg-warning-soft text-warning",
  approved: "bg-success-soft text-success",
  queued: "bg-info-soft text-info",
  printed: "bg-info-soft text-info",
  posted: "bg-info-soft text-info",
  delivered: "bg-success-soft text-success",
  skipped: "bg-foreground/[0.06] text-muted",
  missed: "bg-foreground/[0.06] text-muted",
};

/** Statuses where nothing further will happen to the card. */
export const OCCASION_CLOSED: ReadonlySet<string> = new Set(["delivered", "skipped", "missed"]);

/**
 * What to call one occasion: the name the customer gave it, and the kind of
 * date it is. Both, always.
 *
 * These were being shown one at a time and in opposite directions. The contact
 * page rendered `title ?? type`, so a leaver's date named "96" appeared as a
 * bare "96" with nothing to say what it was. Approvals rendered the type only,
 * so the same row appeared there as "Leaver" with the name discarded. Neither
 * screen ever showed both, and a real customer could not tell what either row
 * meant.
 */
export function occasionName(occasion: { type: string; title?: string | null }): string {
  return occasion.title?.trim() || (OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type);
}

/** The kind, shown alongside `occasionName` — omitted only when the name *is*
 * the kind, where repeating it would read as a stutter ("Birthday · Birthday"). */
export function occasionKind(occasion: { type: string; title?: string | null }): string | null {
  const kind = OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type;
  return occasionName(occasion) === kind ? null : kind;
}

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
