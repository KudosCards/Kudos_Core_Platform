# ADR 0010 — Phase 5 scope: fulfillment/ops queue and the platform-admin actor

Status: accepted
Date: 2026-07-16

## Context

Every prior phase served the tuition-centre customer: import recipients, design cards, approve
occasions, pay, personalise message pages. But nothing fulfils a paid order. `webhooks.service.ts`
creates a `FulfillmentJob` (`status: pending`) per paid `OrderRecipient` and there it stops —
`grep` confirms no code anywhere advances a job past `pending`, there is no ops-facing API or UI,
and the `printed`/`posted`/`delivered` statuses on `FulfillmentJob`/`OrderRecipient`/`Occasion`
and the `fulfilling`/`completed` statuses on `BatchOrder` are unreachable. The schema comment
(`schema.prisma`) already names this: "v1 is an internal ops queue (manual print/post)".

The actor here is fundamentally different from every other endpoint's: **Kudos Cards' own internal
print/post team**, not the B2B customers. They need to see a **cross-account** production queue —
recipient names, shipping addresses, card designs — which is exactly the data every other endpoint
deliberately walls off per-account via `MembershipGuard`. So this phase's central question was how
that internal actor is identified and authorised.

## Decisions

**Platform-admin identity: a dedicated `PlatformAdmin` table**, not a Supabase `app_metadata`
claim and not a reused "internal account" membership. Rationale (confirmed as the intended "best
outcome"):
- The ops allowlist is version-controlled, DB-resident state — auditable and seedable from the
  repo, rather than living in the Supabase dashboard where it can't be reviewed in a PR.
- It keeps the two actor types cleanly orthogonal. Ops staff are *not* members of a tuition
  centre; overloading `Membership`/`Account` to represent them would muddle "member of a customer
  org" with "operator of the platform" — a conflation that tends to leak into authorization bugs.
- A user can independently be both a platform admin and a tuition-centre member (e.g. a Kudos
  employee testing with their own account); the two tables are independent lookups.

`PlatformAdminGuard` runs after the global `JwtAuthGuard` and checks `platform_admins` by the
verified `userId`. Bootstrapping the first admin is env-driven: the seed reads an optional
`PLATFORM_ADMIN_USER_IDS` (comma-separated Supabase user IDs) and upserts them — empty in CI, set
in real environments. This avoids hard-coding a real person's id in the repo while keeping the
allowlist reproducible.

**Web separation mirrors the auth separation**: the ops UI lives in its own `(ops)` route group
with a layout gated on platform-admin status, *not* the `(app)` group's account-membership +
onboarding gate. An ops-only user (no tuition-centre membership) would otherwise be bounced to
onboarding. This keeps the customer app and the internal ops app cleanly separated in one codebase.

**State machine & propagation.** `FulfillmentJob`:
`pending → in_progress → printed → posted → delivered`, plus `→ failed` from any active state. Each
transition is an atomic, status-guarded `updateMany` (the established pattern) and propagates:
- `printed`/`posted`/`delivered` set the matching `*At` timestamp and move the linked
  `OrderRecipient` and its `Occasion` to the same status (`OrderRecipient` has no `in_progress`
  state — that's an ops-internal "being worked on" phase with no customer-facing equivalent).
- The parent `BatchOrder` moves `paid → fulfilling` when its first job starts, and
  `→ completed` once **all** its order recipients are `delivered`.
- `posted` optionally records a `trackingReference`.

**Bulk transitions are first-class.** Real print/post happens in runs — dozens of cards printed,
then posted, together. A bulk transition endpoint (array of job ids → one status) is included, not
deferred, because a queue that only advances one card at a time doesn't match how the work is
actually done.

## Alternatives considered

- **Supabase `app_metadata` role claim** — rejected: moves the security-critical allowlist out of
  the repo into dashboard-managed metadata, harder to audit, seed, and test.
- **Designated "Kudos internal" account + membership** — rejected: conceptually muddles customer
  membership with platform operation; the guard would be checking "is a member of *this specific*
  account", a brittle special-case.
- **A print-vendor API integration now** — deferred: the schema is already provider-agnostic
  (`trackingReference`, timestamps). v1 is a manual internal queue; a real print API plugs into the
  same state machine later without a redesign.

## Consequences

- The order pipeline is finally end-to-end: a paid card can be produced, dispatched, and marked
  delivered, and the customer sees its `Occasion`/`OrderRecipient` progress those statuses.
- `PlatformAdminGuard` is a second, independent authorization axis alongside `MembershipGuard` —
  the first cross-account-privileged surface in the API, so its tests explicitly cover a non-admin
  being refused and an admin seeing across accounts.
- The first platform admin must be bootstrapped via `PLATFORM_ADMIN_USER_IDS` (or a manual row) in
  each real environment — documented, since it can't be seeded blindly.
