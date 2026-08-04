# 0105 — Segments (smart lists) + suggested presets

## Status

Accepted

## Context

User feedback asked for **hyper-targeted lists** — "smart listing suggested by
the system", "upcoming birthdays", and the ability to differentiate lists from
occasions ("separate birthday from renewal from anniversary") as the entry point
to bulk personalise-and-send. Today the only groupings are hand-curated
`RecipientList`s and the raw `/approvals` queue; there is nothing that answers
"who has a birthday this month?" or "who can't we post to yet?" as a saved,
always-current view.

ADR 0104 already made renewal/anniversary first-class recurring occasions, so the
dated substrate the interesting segments need now exists. This slice adds the
**segment** concept on top: a saved, live-resolving filter that produces a count
+ preview. Sending _from_ a segment (filter → bulk personalise → pay → send) is a
deliberately separate later slice — this one only defines and resolves segments.

## Decision

Add a **segment** = a saved filter over the contact book that resolves live to a
count + a small member sample, plus a set of system-suggested presets.

1. **Two resolution modes, one definition.** A `SegmentDefinition`
   (shared-types, zod) is either **occasion-mode** (`occasion: { types[], window }`)
   or **contact-mode** (`contact: { source?, listId?, status?, hasMailableAddress? }`);
   a `.refine` requires at least one. Occasion-mode rides the occasion engine, so
   "birthdays this month" inherits per-year de-dup and lifecycle for free and
   naturally keeps birthday, renewal, and anniversary as _separate_ streams (the
   differentiation the feedback asked for). Contact-mode covers the undated views
   (e.g. "missing an address"), reusing the `MISSING_ADDRESS_WHERE` predicate and
   the recipient status/source/list facets. The occasion `window` is a discriminated
   union: `this_month`, `next_days { days }`, or an explicit `range { from, to }`.

2. **Suggested presets are code-defined, not stored rows.** `SEGMENT_PRESETS`
   (birthdays this month, upcoming birthdays, renewals due, anniversaries this
   month, missing an address) resolve against the account's own data on every
   request. They cost nothing to carry, evolve with the code, and a user can
   **save one as a reusable smart list** — which persists a `Segment` row from the
   preset's definition.

3. **A `Segment` table** (id, accountId, name, `definition` JSON, timestamps),
   `@@unique(accountId, name)` so a saved list name is unique per account, and
   `@@index(accountId, createdAt)` for the list. The definition is stored as JSON
   and re-validated with `segmentDefinitionSchema` on read — the same shape the
   presets use, so saved and suggested segments resolve through one code path.

4. **API.** `GET /segments` returns the overview (`{ suggested[], saved[] }`),
   each entry already resolved to `{ count, sample }` (sample capped at 8, each
   member carrying a short `detail` line — "Birthday · 23 Oct" or "No postal
   address"). `POST /segments` saves a named segment (zod-validated in the service,
   since the discriminated/optional definition is awkward for class-validator;
   duplicate name → 400). `DELETE /segments/:id` removes one. All account-scoped
   behind `MembershipGuard`.

5. **Web.** A new **Segments** page (sidebar, under "Grow relationships") shows
   suggested presets and saved lists as cards — name, live count, a linked member
   preview, "…and N more". Suggested cards offer **Save as list**; saved cards
   offer **Remove**. Members link straight to the recipient profile.

## Consequences

- Every account gets useful, zero-setup smart lists on day one, and can promote any
  of them to a durable saved list. Suggested and saved segments share one
  resolution path, so behaviour can't drift between them.
- Occasion-mode segments are exactly the dated streams ADR 0104 created, so
  birthday/renewal/anniversary stay cleanly separable and per-year de-duplicated
  without segment-specific bookkeeping.
- One additive table (migration `20260804180000_segments`) + a read/create/delete
  endpoint set + one page. No occasion, recipient, or list schema was touched.
- **Sending from a segment is not built yet.** The next slice turns a resolved
  segment into a bulk personalise-and-send flow (filter → design → pay → send);
  the definition/resolution split here is what that slice will consume. Custom-field
  matching in contact-mode is a later extension of `SegmentDefinition` — additive,
  no migration.
