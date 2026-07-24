# ADR 0040 — Separate admin login, operator roles, and team management

Status: accepted
Date: 2026-07-24

## Context

The super-admin surface (`/admin`, fulfillment, catalog, returns) existed (ADR 0010) but had three
gaps: operators signed in through the **same** customer `/login`; the only way to add or remove an
operator was a **manual DB insert**; and every operator was **equal** (no roles). The ask: a
separate admin login, multi-user access, and a real dashboard.

## Decision

### Separate login, same identity provider

Operators sign in at a dedicated **`/admin-login`** (public), distinct from the customer `/login`.
Hitting any ops route unauthenticated redirects there (not `/login`), and ops logout returns there.
After Supabase authentication the page calls `POST /admin/access`, which confirms operator status
(or provisions a newly-invited operator — see below) and routes to `/admin`, or refuses a
non-operator with a clear message.

We deliberately did **not** stand up a second Supabase project for admins. The cryptographic security
boundary is already the API: every token is verified against Supabase's JWKS and every ops route is
gated by `PlatformAdminGuard`. A fully isolated admin IdP is a possible future hardening, but it
can't be provisioned or tested in this environment and buys little over the guard that already runs
on every call. What "separate login" means here is a distinct, branded entry; ops-only routing and
redirects; operator identity in the shell; and in-app team management — all achievable now.

### Roles: super_admin + ops

`PlatformAdmin` gains a `role` (`super_admin` | `ops`, default `ops`) and an `email` (captured on
first sign-in, for the team UI). **Super admin** manages the operator team and platform settings;
**ops** works the dashboards and fulfillment/returns queues. Existing operators were backfilled to
`super_admin` in the migration so nobody lost management ability on upgrade. `SuperAdminGuard` (runs
after `PlatformAdminGuard`, reads its resolved role) gates the management mutations.

### Multi-user onboarding via an email allow-list

A super admin allow-lists an operator's email (`PlatformAdminInvite`, role attached). When that
person signs in at `/admin-login` with a **matching verified Supabase email**, `POST /admin/access`
provisions them as a `PlatformAdmin` (role copied from the invite) and consumes the invite. This
mirrors the team-invite trust model (ADR 0028 — the verified JWT email is the credential) **without**
an email round-trip: internal staff already have logins, and this avoids standing up admin-invite
email infrastructure. A super admin can change roles or revoke operators, and remove pending invites.

**Invite email (added post-ADR).** Allow-listing an operator now also emails them a
branded link to the operator sign-in (`/admin-login`) via the shared `EMAIL_CLIENT`, so
they don't have to be told out-of-band to go and sign in. A super admin can **resend** that
email for any still-pending invite (`POST /admin/team/invites/resend`) in case the first was
lost. A failed send is logged, not thrown — the allow-list row is the source of truth, so the
invite still works and can be re-sent. No token is involved: the email is a convenience
pointer, and access is still gated by the verified-email match at sign-in.

### Guardrails

- **At least one super admin always remains** — demoting or revoking the last one is a 409.
- Management mutations are **super-admin only** at the API (`SuperAdminGuard`), not just hidden in the
  UI; an ops operator can *view* the team but every mutation is refused server-side.
- `POST /admin/access` is the only ops route not behind `PlatformAdminGuard` (it's how a first-time
  operator becomes one); it still requires a valid Supabase JWT and only provisions on an exact
  verified-email allow-list match.

## Alternatives considered

- **A fully separate Supabase project for admins** — strongest isolation, but unprovisionable/
  untestable here and redundant with the per-call guard. Left as future hardening.
- **Custom admin password table** — rejected; rolling our own credential store is a security
  liability next to Supabase's verified auth.
- **Emailed admin-invite tokens** (like team invites) — heavier than needed for a handful of internal
  staff who already have logins; the email allow-list is simpler and just as safe (same verified-email
  match).

## Consequences

- Operators have their own branded sign-in and the shell shows who's signed in and their role.
- Super admins add/remove operators and set roles in-app — no more manual DB inserts.
- Two access tiers separate "runs the business" from "works the queue," enforced at the API.
- No schema-level Prisma enum for the role (a `String` with app-level validation, like `Recipient.source`),
  keeping the migration a plain column add + backfill.
