export const OCCASION_TYPE_LABELS: Record<string, string> = {
  birthday: "Birthday",
  achievement: "Achievement",
  leaver: "Leaver",
  staff_recognition: "Staff recognition",
  seasonal: "Seasonal",
  bespoke_campaign: "Bespoke campaign",
};

/** Human labels for an occasion's lifecycle status (calendar pop-up, etc.). */
export const OCCASION_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  pending_approval: "Pending approval",
  approved: "Approved",
  queued: "In an order",
  printed: "Printed",
  posted: "Posted",
  delivered: "Delivered",
  skipped: "Skipped",
};

export function formatOccasionDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
