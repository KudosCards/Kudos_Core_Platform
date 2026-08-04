import type { SegmentDefinition } from "@kudos/shared-types";

/** A system-suggested segment — a code-defined preset (not a stored row). */
export interface SegmentPreset {
  key: string;
  name: string;
  description: string;
  definition: SegmentDefinition;
}

/**
 * The suggested segments shown to every account. Occasion-mode presets ride the
 * occasion engine (birthday/renewal/anniversary), so per-year de-dup + tracking
 * come for free; the last is a contact-mode preset. See ADR 0105.
 */
export const SEGMENT_PRESETS: SegmentPreset[] = [
  {
    key: "birthdays-this-month",
    name: "Birthdays this month",
    description: "Everyone with a birthday in the current month.",
    definition: { occasion: { types: ["birthday"], window: { kind: "this_month" } } },
  },
  {
    key: "upcoming-birthdays",
    name: "Upcoming birthdays",
    description: "Birthdays in the next 30 days.",
    definition: { occasion: { types: ["birthday"], window: { kind: "next_days", days: 30 } } },
  },
  {
    key: "renewals-due",
    name: "Renewals due",
    description: "Renewals coming up in the next 30 days.",
    definition: { occasion: { types: ["renewal"], window: { kind: "next_days", days: 30 } } },
  },
  {
    key: "anniversaries-this-month",
    name: "Anniversaries this month",
    description: "Anniversaries in the current month.",
    definition: { occasion: { types: ["anniversary"], window: { kind: "this_month" } } },
  },
  {
    key: "missing-address",
    name: "Missing an address",
    description: "Active contacts we can't post to yet.",
    definition: { contact: { hasMailableAddress: false } },
  },
];
