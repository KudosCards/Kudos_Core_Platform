# ADR 0048: Reconcile the saved_designs → card_designs FK drift

Status: Accepted
Date: 2026-07-27

## Context

The Phase 5 index work (ADR 0046) surfaced a pre-existing schema/migration drift:

- `SavedDesign.cardDesign` is an **optional** relation (`cardDesignId String?`), and
  Prisma's default on-delete for an optional relation is `SetNull`. The schema
  never declared an explicit `onDelete`, so it _implied_ `SetNull`.
- But the `init` migration created the FK as `ON DELETE RESTRICT`.

So the database (`RESTRICT`) disagreed with what the schema implied (`SetNull`).
Every `prisma migrate dev` would try to reconcile it; the Phase 5 migration
deliberately excluded the change so a perf migration wouldn't quietly alter
delete semantics.

## Decision

Reconcile toward **`SetNull`**, and make it explicit in the schema.

`SetNull` is the correct behaviour here: a `SavedDesign` stores its own complete
`document` (the full design JSON), so it is self-contained and renders fine even
if the origin catalog template is later removed — the template link simply
clears. Blocking a template deletion (`RESTRICT`), or cascading it into users'
saved work, would both be worse.

This is a deliberate contrast with the `Occasion.savedDesign` relation, which is
explicitly `Restrict` (an occasion without its design is a broken state). Both
on-delete choices are now explicit in the schema, so the two intentions read
side by side and neither drifts again.

## Change

- `schema.prisma`: `SavedDesign.cardDesign` relation now declares
  `onDelete: SetNull` (with a comment explaining why).
- Migration `20260727163727_saved_designs_fk_set_null`: drops and re-adds the FK
  as `ON DELETE SET NULL` — nothing else.

## Consequences

- Deleting a `CardDesign` now nulls `saved_designs.card_design_id` for any saved
  design based on it, instead of being blocked. In practice catalog templates are
  _deactivated_ (`isActive=false`), not hard-deleted, so this rarely triggers —
  but the intended, non-destructive behaviour is now what the DB actually does.
- Verified: the migration is FK-only; the constraint reports `SET NULL`
  (`pg_constraint.confdeltype = 'n'`); a from-scratch `migrate deploy` + seed +
  the full API suite (73 unit + 232 e2e) all green; lint/typecheck/build green.
