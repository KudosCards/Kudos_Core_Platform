# 0231 — Bounding the whole, not the parts

## Status

Accepted — implemented. From the follow-up review's N7, N11, N12 and N13.
Follow-up to ADR 0209.

## Context

ADR 0209 gave every outbound call a deadline and a bounded retry. Four things it
left, three of which are the same shape: **each part is bounded and the sum is
not.**

**N11 — a paging loop has no total.** `httpRequest` bounds each attempt at 15
seconds and each backoff at 30, and each client caps its page count. Multiply
them: HubSpot's fifty pages, four attempts each, is an arithmetic ceiling near
**fifty minutes** — on "Sync now", a request a customer is sitting in front of.
Before the retries existed, the first 429 ended the pull in seconds. Making each
attempt robust made the whole unbounded, which is the trade nobody priced.

**N13 — the email deadline made the ambiguity likelier.** The Brevo send opts
out of retries deliberately: Brevo may have accepted a message and then failed
to answer, and a second attempt puts a second copy in someone's inbox. **An
abort is the same ambiguity wearing a different hat**, and at 15 seconds it is
the more likely of the two. The reminder digest shows the cost: the send throws,
the caller skips the `reminderSentAt` stamp, and tomorrow's run sends the
identical email to someone who already has it — the duplicate the no-retry rule
exists to prevent, arriving a day late.

**N12 — the guard that enforces all this had a hole.** `no-bare-fetch`'s pattern
was `/(?<![.\w])fetch\s*\(/`. The lookbehind excludes any dotted form, so
`globalThis.fetch(url, init)` — the way it gets written when the bare global
feels too implicit — passed straight through, untimed.

**N7 — an ops script whose run procedure discards its own write.** Unrelated to
the above, and the most immediately dangerous. `p2-17-dispatch-date-backfill.sql`
Step 3 opened a bare `BEGIN;` and told the operator to paste one step at a time.
The Supabase SQL editor runs each request in its own session: the `UPDATE`
reports `UPDATE 111`, then rolls back when the session ends, and the separately
pasted `COMMIT;` lands in a session with no open transaction. **The operator
reads a row count matching the dry run and concludes it applied while nothing
was written.** `p2-18`, written a day later, states the correct thing about the
same tool — so the repository contained both the mistake and its correction, a
day apart, neither aware of the other.

## Decision

**A wall-clock budget per contacts pull**, checked between pages, in
`fetch-budget.ts`. Two minutes: long enough that a healthy portal of any size
finishes inside it, short enough that a manual sync fails visibly rather than
appearing to hang.

Running out of budget is reported the same way as running out of pages —
`truncated` — which ADR 0227 already turns into a status the customer can read
and an amber summary. "We stopped early" was a first-class outcome; this is
another way to reach it, and it needed no new vocabulary.

Checked _between_ pages, never mid-request: a page already paid for is worth
keeping.

**A 60-second deadline on the email send**, four times the default, chosen so
that reaching it means "not delivered" rather than "slow". It still bounds the
call — a hung Brevo cannot hold a caller open indefinitely.

The cost is named rather than hidden: `maybeSendOrderEmail` runs inside the
Stripe webhook handler, and a pathological Brevo could now push that past
Stripe's response window and earn a webhook retry. That retry is a no-op — the
handler is status-guarded, and the email only sends on the first delivery — so
the trade is a duplicate delivery that changes nothing, against a duplicate
email that a customer reads.

**The guard's pattern now matches a dotted call**, while still requiring `fetch`
to be the whole identifier so `this.fetchContacts(` and `prefetch(` stay out.
Verified by adding `globalThis.fetch(url, {})` to a real file and watching the
guard name it.

**p2-17's Step 3 is one self-contained statement with `RETURNING`**, as p2-18's
is, and the run procedure explains what the editor actually does. The safety
`BEGIN` was reaching for is still there, in a different place: Step 1 is the dry
run and shares Step 3's `WHERE`; Step 3 returns what it changed; Step 4 verifies.

Its remap table was re-checked against `computeDispatchDate` and is unaffected
by ADR 0230, which changed only which rule `suggestFirstClass` reports — the
dates are identical.

**p2-18's Step 0 gate now counts what its Step 3 writes.** The gate counted
`closed_at IS NOT NULL` while the write is `resolved_at IS NULL` with no mention
of `closed_at`, so a ticket resolved and never closed was recoverable but
invisible to the gate — an operator could read 0, stop, and leave rows behind.
A gate must count the population the write will touch.

## Consequences

- A contacts pull cannot exceed two minutes, on any provider, and says so when
  it stops early.
- A slow email send is no longer reported as a failed one.
- Seven tests for the budget and its wiring; three pinning the email deadline;
  the guard's own self-test extended with the dotted forms.
- Two structural guards, each self-tested by breaking it: every paging loop must
  check the budget (removing one check fails), and every `Sentry.init`-style
  omission stays caught.

The email deadline tests are **knowingly weak**, and say so in their own
comment. `AbortSignal.timeout` does not expose its duration, and jest's fake
timers do not drive it — measured with a throwaway probe rather than assumed:
the abort simply never fires in fake time. So the obvious test, "a send that
takes twenty seconds is not aborted", would pass against a one-millisecond
deadline just as happily. Writing it would have added a case that could not
fail, which is the exact failure this round of work keeps finding (ADRs 0227,
0229). They pin the two things that can silently regress instead — the number,
and that it is the one passed.

## What the three of them have in common

A bound on each part is not a bound on the whole, and the second does not follow
from the first — it usually gets _worse_ as the first improves. Each retry made
a page more likely to succeed and the pull longer. A shorter deadline made each
call fail faster and a duplicate email likelier. The guard got more precise
about what a bare `fetch` looks like and stopped seeing one of the two ways to
write it.

Where a loop, a retry or a fan-out exists, the question worth asking is not "is
each step bounded" but "what is the largest this can be, and would anyone accept
waiting for it".
