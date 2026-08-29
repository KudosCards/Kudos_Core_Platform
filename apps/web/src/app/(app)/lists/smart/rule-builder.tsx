"use client";

import { useEffect, useRef, useState } from "react";
import type {
  OccasionType,
  RecipientListSummary,
  SegmentDefinition,
  SegmentPreview,
} from "@kudos/shared-types";
import { clientApiFetch } from "@/lib/api.client";

/**
 * The rule behind a smart list, made editable.
 *
 * `SegmentDefinition` has always accepted a great deal — any mix of occasion
 * types over three kinds of date window, or contact filters on source, status,
 * postal address and membership of another list. None of it was reachable: the
 * only way to make a smart list was "Save as list" on one of five fixed
 * suggestions, which copied that suggestion's rule verbatim under a new name.
 * The saved card then behaved identically to the suggestion above it, so the
 * action appeared to do nothing.
 *
 * Every field here is one the API already understood. The count beside the form
 * is resolved by the server on each edit (`POST /segments/preview`), so it is
 * the real answer for the rule as it stands rather than a promise the save has
 * to make good on.
 */

const OCCASION_LABELS: Record<OccasionType, string> = {
  birthday: "Birthdays",
  renewal: "Renewals",
  anniversary: "Anniversaries",
  achievement: "Achievements",
  leaver: "Leavers",
  staff_recognition: "Staff recognition",
  seasonal: "Seasonal",
  bespoke_campaign: "Bespoke campaigns",
};

/** Ordered so the three the scheduler generates automatically come first. */
const OCCASION_ORDER: OccasionType[] = [
  "birthday",
  "renewal",
  "anniversary",
  "achievement",
  "leaver",
  "staff_recognition",
  "seasonal",
  "bespoke_campaign",
];

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added by hand",
  csv: "CSV import",
  api: "API",
  brevo: "Brevo",
  hubspot: "HubSpot",
  gohighlevel: "GoHighLevel",
};

type Mode = "occasion" | "contact";
type WindowKind = "this_month" | "next_days" | "range";
type AddressChoice = "any" | "missing" | "mailable";

export interface RuleState {
  mode: Mode;
  types: OccasionType[];
  windowKind: WindowKind;
  days: number;
  from: string;
  to: string;
  source: string;
  status: "" | "active" | "lapsed" | "archived";
  address: AddressChoice;
  listId: string;
}

export const EMPTY_RULE: RuleState = {
  mode: "occasion",
  types: ["birthday"],
  windowKind: "next_days",
  days: 30,
  from: "",
  to: "",
  source: "",
  status: "",
  address: "any",
  listId: "",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A rule state back to the wire shape, or null while it is still incomplete. */
export function toDefinition(rule: RuleState): SegmentDefinition | null {
  if (rule.mode === "occasion") {
    if (rule.types.length === 0) return null;
    if (rule.windowKind === "next_days") {
      if (!Number.isInteger(rule.days) || rule.days < 1 || rule.days > 366) return null;
      return { occasion: { types: rule.types, window: { kind: "next_days", days: rule.days } } };
    }
    if (rule.windowKind === "range") {
      if (!ISO_DATE.test(rule.from) || !ISO_DATE.test(rule.to)) return null;
      if (rule.from > rule.to) return null;
      return {
        occasion: { types: rule.types, window: { kind: "range", from: rule.from, to: rule.to } },
      };
    }
    return { occasion: { types: rule.types, window: { kind: "this_month" } } };
  }

  const contact = {
    ...(rule.source && { source: rule.source }),
    ...(rule.status && { status: rule.status }),
    ...(rule.listId && { listId: rule.listId }),
    ...(rule.address === "missing" && { hasMailableAddress: false }),
    ...(rule.address === "mailable" && { hasMailableAddress: true }),
  };
  // A contact rule with nothing set means "every active contact", which is a
  // real answer — the server defaults status to active — so it is allowed.
  return { contact };
}

/** An existing definition back into form state, for editing a saved rule. */
export function fromDefinition(definition: SegmentDefinition): RuleState {
  if (definition.occasion) {
    const { types, window } = definition.occasion;
    return {
      ...EMPTY_RULE,
      mode: "occasion",
      types,
      windowKind: window.kind,
      days: window.kind === "next_days" ? window.days : EMPTY_RULE.days,
      from: window.kind === "range" ? window.from : "",
      to: window.kind === "range" ? window.to : "",
    };
  }
  const contact = definition.contact ?? {};
  return {
    ...EMPTY_RULE,
    mode: "contact",
    source: contact.source ?? "",
    status: contact.status ?? "",
    listId: contact.listId ?? "",
    address:
      contact.hasMailableAddress === false
        ? "missing"
        : contact.hasMailableAddress === true
          ? "mailable"
          : "any",
  };
}

/**
 * A plain-English restatement of the rule, above the count.
 *
 * Built as a noun phrase rather than a comma-joined list of clauses, which read
 * as "Active contacts, we can post to, already on another list." The list is
 * named where one is known, because "another list" makes the reader go and
 * check which.
 */
export function describe(rule: RuleState, lists: RecipientListSummary[] = []): string {
  if (rule.mode === "occasion") {
    const names = rule.types.map((t) => OCCASION_LABELS[t].toLowerCase());
    const joined =
      names.length <= 1
        ? (names[0] ?? "occasions")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const when =
      rule.windowKind === "this_month"
        ? "this month"
        : rule.windowKind === "next_days"
          ? `in the next ${rule.days} ${rule.days === 1 ? "day" : "days"}`
          : rule.from && rule.to
            ? `between ${rule.from} and ${rule.to}`
            : "between two dates";
    return `Contacts with ${joined} ${when}.`;
  }

  const qualifiers: string[] = [];
  if (rule.source) qualifiers.push(`from ${SOURCE_LABELS[rule.source] ?? rule.source}`);
  if (rule.listId) {
    const named = lists.find((l) => l.id === rule.listId);
    qualifiers.push(named ? `on ${named.name}` : "on one of your other lists");
  }

  let sentence = `${rule.status || "active"} contacts`;
  if (qualifiers.length > 0) sentence += ` ${qualifiers.join(", ")}`;
  // The address clause goes last and takes a comma once anything precedes it.
  // Ordered this way because "we can post to on Year 5 class" collides two
  // prepositions; "on Year 5 class, with a postal address" does not.
  if (rule.address !== "any") {
    const clause = rule.address === "mailable" ? "with a postal address" : "with no postal address";
    sentence += `${qualifiers.length > 0 ? ", " : " "}${clause}`;
  }
  return `${sentence}.`.replace(/^./, (c) => c.toUpperCase());
}

export function RuleBuilder({
  rule,
  onChange,
  lists,
}: {
  rule: RuleState;
  onChange: (next: RuleState) => void;
  lists: RecipientListSummary[];
}) {
  // The answer is stamped with the rule it answered, so an edit invalidates it
  // by mismatch rather than by a state reset — which is both simpler and the
  // only version that doesn't render one frame of the previous rule's count.
  const [answer, setAnswer] = useState<{
    for: string;
    result: SegmentPreview | null;
    failed: boolean;
  } | null>(null);

  const definition = toDefinition(rule);
  const serialised = definition ? JSON.stringify(definition) : null;

  // One in-flight preview at a time: a late reply for a rule that has since
  // been edited is discarded rather than overwriting a newer count.
  const requestId = useRef(0);
  useEffect(() => {
    if (!serialised) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      clientApiFetch<SegmentPreview>("/segments/preview", {
        method: "POST",
        body: JSON.stringify({ definition: JSON.parse(serialised) as SegmentDefinition }),
      })
        .then((result) => {
          if (id === requestId.current) setAnswer({ for: serialised, result, failed: false });
        })
        .catch(() => {
          if (id === requestId.current) setAnswer({ for: serialised, result: null, failed: true });
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [serialised]);

  const current = answer && answer.for === serialised ? answer : null;
  const preview = current?.result ?? null;
  const previewError = current?.failed ? "Could not work out who this matches just now." : null;
  const previewing = current === null;

  const fieldClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  function toggleType(type: OccasionType) {
    const next = rule.types.includes(type)
      ? rule.types.filter((t) => t !== type)
      : [...rule.types, type];
    onChange({ ...rule, types: next });
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Who should this list find?</legend>
        {(
          [
            ["occasion", "People with a date coming up", "Birthdays, renewals, anniversaries."],
            [
              "contact",
              "People matching their details",
              "Where they came from, whether we can post to them.",
            ],
          ] as const
        ).map(([value, label, help]) => (
          <label
            key={value}
            className={
              rule.mode === value
                ? "flex cursor-pointer gap-3 rounded-lg border border-accent bg-accent-soft px-3 py-2.5"
                : "flex cursor-pointer gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-foreground/[0.02]"
            }
          >
            <input
              type="radio"
              name="rule-mode"
              checked={rule.mode === value}
              onChange={() => onChange({ ...rule, mode: value })}
              className="mt-0.5 size-4 accent-accent"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {rule.mode === "occasion" ? (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Which dates</legend>
            <div className="flex flex-wrap gap-2">
              {OCCASION_ORDER.map((type) => {
                const on = rule.types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleType(type)}
                    className={
                      on
                        ? "rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white"
                        : "rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-foreground/[0.03]"
                    }
                  >
                    {OCCASION_LABELS[type]}
                  </button>
                );
              })}
            </div>
            {rule.types.length === 0 && (
              <p className="text-xs text-danger">Pick at least one kind of date.</p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">When</legend>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["this_month", "This month"],
                  ["next_days", "In the next…"],
                  ["range", "Between two dates"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={rule.windowKind === kind}
                  onClick={() => onChange({ ...rule, windowKind: kind })}
                  className={
                    rule.windowKind === kind
                      ? "rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white"
                      : "rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-foreground/[0.03]"
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {rule.windowKind === "next_days" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="number"
                  min={1}
                  max={366}
                  value={rule.days}
                  onChange={(event) => onChange({ ...rule, days: Number(event.target.value) })}
                  aria-label="Number of days"
                  className={`${fieldClass} w-24`}
                />
                <span className="text-muted">days from today</span>
              </label>
            )}

            {rule.windowKind === "range" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-muted">From</span>
                  <input
                    type="date"
                    value={rule.from}
                    onChange={(event) => onChange({ ...rule, from: event.target.value })}
                    className={fieldClass}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-muted">to</span>
                  <input
                    type="date"
                    value={rule.to}
                    onChange={(event) => onChange({ ...rule, to: event.target.value })}
                    className={fieldClass}
                  />
                </label>
                {rule.from && rule.to && rule.from > rule.to && (
                  <p className="w-full text-xs text-danger">
                    The first date needs to come before the second.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Where they came from</span>
            <select
              value={rule.source}
              onChange={(event) => onChange({ ...rule, source: event.target.value })}
              className={fieldClass}
            >
              <option value="">Anywhere</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Contact status</span>
            <select
              value={rule.status}
              onChange={(event) =>
                onChange({ ...rule, status: event.target.value as RuleState["status"] })
              }
              className={fieldClass}
            >
              <option value="">Active (default)</option>
              <option value="active">Active</option>
              <option value="lapsed">Lapsed</option>
              <option value="archived">Archived</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Postal address</span>
            <select
              value={rule.address}
              onChange={(event) =>
                onChange({ ...rule, address: event.target.value as AddressChoice })
              }
              className={fieldClass}
            >
              <option value="any">Either way</option>
              <option value="mailable">Only those with a postal address</option>
              <option value="missing">Only those with no postal address</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">On another list</span>
            <select
              value={rule.listId}
              onChange={(event) => onChange({ ...rule, listId: event.target.value })}
              className={fieldClass}
              disabled={lists.length === 0}
            >
              <option value="">Any list, or none</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
            {lists.length === 0 && (
              <span className="text-xs text-muted">
                You have no hand-picked lists to narrow by yet.
              </span>
            )}
          </label>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm font-medium">{describe(rule, lists)}</p>
        {previewError ? (
          <p className="mt-2 text-sm text-muted">{previewError}</p>
        ) : !definition ? (
          <p className="mt-2 text-sm text-muted">Finish the rule to see who it matches.</p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              <span className="text-2xl font-bold text-accent">
                {previewing || !preview ? "—" : preview.count}
              </span>{" "}
              <span className="text-muted">
                {preview?.count === 1 ? "person matches right now" : "people match right now"}
              </span>
            </p>
            {preview && preview.sample.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {preview.sample.slice(0, 5).map((member) => (
                  <li key={member.recipientId} className="flex justify-between gap-3">
                    <span className="truncate">{member.name}</span>
                    {member.detail && <span className="shrink-0 text-muted">{member.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
