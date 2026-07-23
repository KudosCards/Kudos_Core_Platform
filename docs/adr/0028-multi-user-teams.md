# ADR 0028 — Multi-user organisations (team invites + roles)

Status: **accepted**
Date: 2026-07-23

## Context

User feedback: "Support multiple users within an organisation, potentially higher-tier." Until now
an account had exactly one login — the owner who signed up. A tuition centre with several
administrators had to share one password. This adds a proper team: invite colleagues by email, each
with their own login and a role.

The data model was already most of the way there: `Membership(accountId, userId, role)` with a
`MembershipRole` enum (`owner | admin | staff`) and a `MembershipGuard` that resolves the caller's
membership. What was missing was a way to *create* additional memberships safely, and a UI for it.

## Decision

### Gating — Centre plan only

A new `PlanEntitlement.teamSeatsEnabled` flag (seeded off for Free/Pro, on for Centre). Inviting is
refused with a clear 403 on plans without it. This matches the "potentially higher-tier" steer and
keeps multi-user as a Centre-tier differentiator. The gate is enforced server-side in
`TeamService.createInvite`, so the web gating is only UX.

### Invites

New `Invite` model: `{ accountId, email (lowercased), role, token (unique secret), status
(pending|accepted|revoked), expiresAt, ... }`, unique on `(accountId, email)` so re-inviting
replaces the prior row with a fresh token. The **token is a secret** — like the guest claim token,
it's never returned by the API; it travels only in the invite email (a branded `EMAIL_CLIENT` send).

Endpoints:
- `GET /team` — members, pending invites, `teamSeatsEnabled`, and the viewer's role. Any member may
  view.
- `POST /team/invites` `{ email, role }` — owner/admin only, gated; sends the invite email.
- `POST /team/invites/:id/revoke`, `DELETE /team/members/:userId`,
  `PATCH /team/members/:userId/role` — team management.
- `GET /invites/:token` (public) — a minimal preview (account name, role, email, expired) for the
  accept page. Reveals only what the token holder already has.
- `POST /invites/:token/accept` (authenticated, **not** MembershipGuard — this is the moment the
  invitee gets their first membership, like signup).

### Roles

- **owner** — the one who signed up. Full control; can change roles. Never invitable or removable.
- **admin** — can manage the team (invite/revoke, remove staff) and everything staff can. Only the
  owner can remove or demote an admin, and only the owner changes roles.
- **staff** — normal app usage; no team management.

### Membership email

`Membership.email` (nullable) is now captured at creation — from the signing-up user for the owner,
from the invite for invited members — so the team UI can show *who* each member is (there's no local
user table; identity lives in Supabase). Backfilled best-effort for existing owners from
`Account.contactEmail`.

### Security properties

- **Email binding**: accepting requires the invitee's verified JWT email to match the invite's
  (case-insensitive). A forwarded link can't be redeemed by someone else.
- **Expiry**: invites expire after 14 days; an expired or non-pending token can't be accepted.
- **One-user-one-account (retained)**: accepting fails with a clear 409 if the user already belongs
  to an account — the same invariant `signup` and the guest-claim flow already enforce. This avoids
  silently landing a multi-membership user on the wrong account, since `MembershipGuard` resolves
  the *oldest* membership and there is no account switcher yet.

### Web

- `/team` page (sidebar → Account) — member list with role/remove controls (owner/admin only, never
  on the owner or yourself), pending invites with revoke, and an invite form; free/pro accounts see
  an upgrade-to-Centre prompt instead.
- `/invite/[token]` — a **public** accept page. The invitee opens it from their email; if not signed
  in it authenticates them inline (create-login or sign-in, email locked to the invite) then accepts;
  if already signed in with the matching email, one click joins. Email-confirmation-required signups
  can reopen the same link after confirming.

## Consequences

- Multi-user is a real Centre-tier feature with per-person logins and least-privilege roles.
- The one-account-per-user limitation is explicit and safe rather than a silent trap. A proper
  account switcher (letting one login belong to several accounts) is a deliberate future enhancement
  — it needs `MembershipGuard` to take an "active account" rather than the oldest membership.
- No billing/seat-count metering yet: the Centre plan allows inviting without a hard cap. If seat
  pricing is wanted later, the invite path is the single chokepoint to enforce it.
