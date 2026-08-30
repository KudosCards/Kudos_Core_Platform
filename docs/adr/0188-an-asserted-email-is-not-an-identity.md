# 0188 — An asserted email is not an identity

## Status

Accepted — implemented. From an external code review (finding 11 of 37).

## Context

`JwtAuthGuard` verifies a Supabase JWT properly: ES256, signature against the
project's JWKS, expiry, and `aud`. Then it did this:

```ts
const authUser: AuthenticatedUser = {
  id: payload.sub,
  email: payload.email ?? null,
};
```

`sub` is proven. `email` is a **claim the token carries**, and it was named as if
it were an identity. Three authorization decisions rested on it, and all three
docstrings said the word "verified":

| Decision                   | What the email does                                    | What else binds it             |
| -------------------------- | ------------------------------------------------------ | ------------------------------ |
| `AdminTeamService.access`  | provisions a `PlatformAdmin` — cross-tenant ops access | **nothing**                    |
| `TeamService.acceptInvite` | joins an organisation at the invited role              | a token emailed to the address |
| `GuestClaimService.claim`  | takes over a guest account holding a paid order        | a token emailed to the address |

Nothing enforced the word. ADR 0040 states the property explicitly — _"a
**matching verified** Supabase email"_ — and the only thing standing between the
claim and reality was the Supabase project's email-confirmation toggle, which
`register/page.tsx` already has a first-class branch for switching off
("Created inline — no confirmation hop").

### Two things the review's suggested fix does not survive

**`user_metadata` is writable by the user it belongs to.** Supabase mirrors
confirmation into `user_metadata.email_verified`, and `auth.updateUser({ data })`
writes that same object. So "populate `authUser.email` only when
`email_verified` is true" is a guard an account holder can simply set. It is
worth having — it catches an _honest_ session carrying an unconfirmed address,
which is what an OAuth provider that never checked the address produces — but it
is not a boundary.

**Under auto-confirm, `email_confirmed_at` is set at signup anyway.** So an
authoritative lookup does not rescue a misconfigured project either. Nothing in
the API can.

What separates the three call sites is therefore not the strength of the email
check but **whether anything else binds the request**. Two of them have a
capability token, emailed to the intended address; the email match is their
second factor. Operator provisioning has no token at all — `PlatformAdminInvite`
is looked up **by email** — so an address alone decides whether someone becomes
a Kudos operator.

## Decision

### The field is renamed so the trust level is unavoidable

`AuthenticatedUser.email` → `unverifiedEmail`, plus `emailVerified`. Every one
of the seven call sites became a compile error and had to be decided on
individually, which is the point: `email` read as proven and was used as such.

`verifiedEmailFromToken(user)` returns the address only when the token asserts
confirmation, and is a function rather than a field so that reaching for it is a
visible choice next to an alternative that is named honestly.

### Each decision gets the check its bindings justify

- **Invite acceptance and guest claim** use `verifiedEmailFromToken`. The token
  is the primary binding; requiring a confirmed address stops a forwarded link
  being redeemed by whoever received it, which is exactly what those docstrings
  always claimed.
- **Operator provisioning** asks Supabase. `resolveOperatorEmail` no longer
  prefers the claim: it reads the authoritative user record and requires
  `email_confirmed_at`. One extra round-trip, on admin sign-in only, for the
  highest-privilege decision in the system — and the only one a user-writable
  metadata field could otherwise have decided.
- **Signup and the operator's own profile** keep the claim, with a comment
  saying why: the first is the signer's own contact detail, the second is
  display. Neither authorizes anything.

### The test minter now mirrors reality

`mintToken` emits `user_metadata.email_verified: true` by default, because that
is what a real session for a confirmed user looks like, and takes a flag to mint
the unconfirmed variety the new tests use.

## Consequences

- An unconfirmed address provisions no operator, accepts no invite, and claims
  no order.
- Two mutations, each caught: dropping the `email_confirmed_at` requirement
  (2 tests), and returning the raw claim from `verifiedEmailFromToken` (1 test).
- Three existing `admin-team` fixtures now supply a confirmed user, because the
  path they exercise reads the record rather than the claim.
- **The project setting is still load-bearing, and this ADR does not pretend
  otherwise.** With "Confirm email" off, Supabase confirms every address at
  signup and no server-side check can tell the difference. That setting should
  be treated as a security control, and the review's phrase is the right one: a
  three-path invariant should not rest on a dashboard toggle. What has changed
  is that two paths now also require a capability token, and the third asks the
  authoritative record instead of a field the user can write.
