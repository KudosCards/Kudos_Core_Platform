# 0189 — A recovery link should not outlive the recovery

## Status

Accepted — implemented. From an external code review (finding 12 of 37).

## Context

The Returned-to-Sender email carries a secret token that authorises five
unauthenticated routes: read the case, rewrite the contact's address, resend,
hand-deliver, archive. It is the sole credential — there is no login.

It had no expiry and was never revoked. `resolveToken` matched on the token
alone:

```ts
const found = await this.prisma.returnCase.findFirst({
  where: { publicToken: token },
});
if (!found) throw new NotFoundException("This link is invalid or has expired");
```

The message has always said _"or has expired"_. Nothing expired. There was no
expiry column, and neither `recoverOnce` nor `archive` nulled the token when the
case closed — so the credential outlived the thing it existed for, permanently.

Both sibling bearer tokens in this codebase are bounded: invites at 14 days,
guest claims at 30. This one was the exception, and it is the one that reaches
the most sensitive surface.

### What a stale link could do

- **Read the case, for ever.** Recipient name, business name, occasion, order
  number — personal data about a named person, on a permanent unauthenticated
  URL, to anyone who ever obtains it: a forwarded email, a shared mailbox, an
  ex-employee's inbox, browser-history sync.
- **Rewrite the contact's postal address, while the case is open.**
  `updateAddress` writes to the **Recipient**, not just the case — and that is
  the address every future automatic birthday card goes to. A silent redirect of
  a customer's ongoing sends.

The read has no status guard at all, so it was unbounded in both time and case
state.

## Decision

`ReturnCase` gains `publicTokenExpiresAt`, and `resolveToken` requires it to be
in the future. `RTS_TOKEN_TTL_DAYS` is 30, matching the guest claim — the closer
analogue of the two, since both are sent to a customer who may take a while to
notice the email and both hand over something that matters.

**The token is nulled when the case closes**, on all three closing paths
(resend, hand-deliver, archive). A case that is resolved has nothing left for
the link to do, so it stops being a credential at that moment rather than
lingering until its TTL runs out.

### The migration backfills rather than leaving old tokens unbounded

Those links are in customers' inboxes right now, and they are exactly what this
fixes — so leaving existing rows null (which would read as "no expiry") would fix
nothing. The backfill dates each expiry from the case's creation, giving every
token the 30-day life it would have had if the column had always existed, and
revokes outright any token on an already-closed case.

Verified against a database seeded with the four shapes:

| Case                  | Before    | After                 |
| --------------------- | --------- | --------------------- |
| open, 3 days old      | permanent | live for 26 more days |
| open, 200 days old    | permanent | **expired**           |
| resolved, 10 days old | permanent | **revoked**           |
| archived, 10 days old | permanent | **revoked**           |

A customer mid-recovery keeps their link; a stale or finished one dies on
deploy. That asymmetry is the point of dating from creation rather than from the
migration.

## Consequences

- The 404 message is now true.
- Two mutations, each caught: dropping the expiry filter (1 test), and no longer
  nulling the token on close (2 tests).
- **This closes the window the previous ADR left open.** ADR 0187 stopped tokens
  being written to logs but could not un-log what was already there, and noted
  that invites and guest claims age out on their own while the RTS token never
  would. It does now: every historical RTS token in any retained log is dead
  within 30 days of its case being opened, and immediately if that case has
  since closed.
- **Not addressed here.** A case left open indefinitely still exposes its read
  route for the full 30 days, and there is no way for a customer to revoke a
  link early other than by resolving or archiving the case. Neither seemed worth
  a control of its own at this size.
