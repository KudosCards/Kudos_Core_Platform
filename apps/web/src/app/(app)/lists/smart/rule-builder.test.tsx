import type { RecipientListSummary, SegmentDefinition } from "@kudos/shared-types";
import { EMPTY_RULE, describe as describeRule, fromDefinition, toDefinition } from "./rule-builder";

/**
 * The rule builder's translation layer. Everything the customer sets ends up
 * here, and a mistake either saves a rule that finds the wrong people or
 * refuses to save one that is perfectly valid.
 */

const LIST_ID = "11111111-1111-4111-8111-111111111111";
const lists: RecipientListSummary[] = [
  {
    id: LIST_ID,
    name: "Year 4 class",
    memberCount: 3,
    sample: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("toDefinition", () => {
  it("refuses an occasion rule with no dates picked", () => {
    expect(toDefinition({ ...EMPTY_RULE, types: [] })).toBeNull();
  });

  it("refuses a day count the API would reject, rather than failing on save", () => {
    // segmentWindowSchema caps days at 366 and requires a positive integer.
    expect(toDefinition({ ...EMPTY_RULE, days: 0 })).toBeNull();
    expect(toDefinition({ ...EMPTY_RULE, days: 367 })).toBeNull();
    expect(toDefinition({ ...EMPTY_RULE, days: 1.5 })).toBeNull();
    expect(toDefinition({ ...EMPTY_RULE, days: 366 })).not.toBeNull();
  });

  it("refuses a backwards date range", () => {
    const range = { ...EMPTY_RULE, windowKind: "range" as const };
    expect(toDefinition({ ...range, from: "2026-09-01", to: "2026-08-01" })).toBeNull();
    expect(toDefinition({ ...range, from: "2026-08-01", to: "2026-09-01" })).not.toBeNull();
  });

  it("refuses a half-filled date range", () => {
    const range = { ...EMPTY_RULE, windowKind: "range" as const };
    expect(toDefinition({ ...range, from: "2026-08-01", to: "" })).toBeNull();
  });

  it("sends both directions of the address filter, and neither when it's 'any'", () => {
    const contact = { ...EMPTY_RULE, mode: "contact" as const };
    expect(toDefinition({ ...contact, address: "missing" })).toEqual({
      contact: { hasMailableAddress: false },
    });
    expect(toDefinition({ ...contact, address: "mailable" })).toEqual({
      contact: { hasMailableAddress: true },
    });
    // Not `undefined` — the key must be absent, or "either way" would be read
    // as a filter.
    expect(toDefinition({ ...contact, address: "any" })).toEqual({ contact: {} });
  });

  it("combines contact filters rather than letting one win", () => {
    expect(
      toDefinition({
        ...EMPTY_RULE,
        mode: "contact",
        source: "brevo",
        status: "lapsed",
        address: "mailable",
        listId: LIST_ID,
      }),
    ).toEqual({
      contact: {
        source: "brevo",
        status: "lapsed",
        listId: LIST_ID,
        hasMailableAddress: true,
      },
    });
  });
});

describe("fromDefinition", () => {
  it.each<[string, SegmentDefinition]>([
    ["this month", { occasion: { types: ["birthday"], window: { kind: "this_month" } } }],
    [
      "next N days",
      { occasion: { types: ["renewal", "anniversary"], window: { kind: "next_days", days: 14 } } },
    ],
    [
      "a date range",
      {
        occasion: {
          types: ["seasonal"],
          window: { kind: "range", from: "2026-12-01", to: "2026-12-24" },
        },
      },
    ],
    ["missing address", { contact: { hasMailableAddress: false } }],
    ["mailable + list", { contact: { hasMailableAddress: true, listId: LIST_ID } }],
    ["source + status", { contact: { source: "hubspot", status: "archived" } }],
  ])("round-trips %s unchanged", (_label, definition) => {
    // A saved rule opened for editing and saved again untouched must be the
    // same rule — otherwise editing the name quietly rewrites the rule.
    expect(toDefinition(fromDefinition(definition))).toEqual(definition);
  });
});

describe("describe", () => {
  it("reads as a sentence when clauses combine", () => {
    expect(
      describeRule({ ...EMPTY_RULE, mode: "contact", address: "mailable", listId: LIST_ID }, lists),
      // Not "Active contacts, we can post to, already on another list."
    ).toBe("Active contacts on Year 4 class, with a postal address.");
  });

  it("names the list rather than calling it 'another list'", () => {
    expect(describeRule({ ...EMPTY_RULE, mode: "contact", listId: LIST_ID }, lists)).toContain(
      "Year 4 class",
    );
  });

  it("says what an occasion rule catches, in words and not field names", () => {
    expect(describeRule({ ...EMPTY_RULE, types: ["birthday"], days: 30 })).toBe(
      "Contacts with birthdays in the next 30 days.",
    );
    expect(
      describeRule({ ...EMPTY_RULE, types: ["renewal", "anniversary"], windowKind: "this_month" }),
    ).toBe("Contacts with renewals and anniversaries this month.");
  });

  it("uses the singular for one day", () => {
    expect(describeRule({ ...EMPTY_RULE, days: 1 })).toContain("in the next 1 day.");
  });
});
