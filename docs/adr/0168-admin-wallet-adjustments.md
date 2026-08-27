# 0168 — Crediting a customer's wallet by hand

## Status

Accepted — implemented.

## Context

Rewarding an engaged customer meant issuing a discount code: something to
create, distribute, track, and eventually retire, which only pays off when the
customer next buys. The obvious alternative — put £10 on their wallet — had no
mechanism at all.

The groundwork was already there and unused. `WalletEntryType` has carried a
fourth value, `adjustment`, since the wallet shipped (ADR 0012); the schema
comment describes it as how corrections are made to an append-only ledger; the
customer's wallet page already has a label for it. **Nothing had ever written
one.** Three code paths touch the ledger — a Stripe top-up, an order payment, an
order refund — and every one of them is initiated by the customer. Ops could
read a balance on the Customer 360 page and do nothing else with it.

## Decision

A super-admin can apply a wallet **adjustment** from the customer's profile: an
amount, a reason, and it takes effect immediately.

**A new ledger row, never an edited balance.** The ledger is append-only by
design and the balance is the sum of its rows, so a credit is one more row. This
is what `adjustment` was reserved for.

**Debits as well as credits.** A credit-only tool has no remedy for its own
mistakes: the first mistyped amount would need a hand-written SQL statement
against a ledger whose entire purpose is that nobody does that. A debit may not
take the balance below zero — money already spent has gone to physical work, and
no other part of the system is written to expect an overdrawn wallet.

**Bounded at £1,000 either way**, matching the customer-facing top-up guardrail.
These are goodwill gestures; an unbounded field's characteristic failure is a
slipped decimal.

**A reason is required and audited.** This moves money on a customer's account
with _no payment behind it_. Who did it and why is the record that makes it
defensible, so the audit write is not fire-and-forget.

**Idempotent on a client-supplied `requestId`**, like the top-up path. A
duplicate credit is not self-correcting — somebody has to notice it and reverse
it — so a double-submitted form must not be able to cause one.

**Serializable**, like every other balance write, so it cannot interleave with a
concurrent order payment and compute its balance from a stale read.

### A balance bug found on the way

The Customer 360 page read the balance from the **newest ledger row's
`balanceAfterMinor` snapshot**, ordered by `createdAt desc`. The wallet's own
definition of a balance is the sum of the rows, and `createdAt desc` picks an
arbitrary row among any sharing a timestamp — so ops could see a balance that was
merely one of several plausible ones. It now sums, like the spend path, so ops
and the customer can never be looking at different numbers.

## Alternatives considered

**Keep issuing discount codes.** They discount a _future_ purchase, need
distribution and tracking, and give no attributable record of who granted what.
A wallet credit lands immediately, appears on the customer's own balance, and —
because the wallet is what makes hands-off automation possible (ADR 0013) —
pushes an engaged customer toward the behaviour we want.

**Let ops edit the balance directly.** Impossible without abandoning the
append-only ledger, which is the thing that makes the wallet auditable.

**Credit-only, no debits.** Simpler, and safer against misuse, but it leaves
every mistake permanent. With a mandatory reason and a full audit trail, a
guarded debit is the lesser risk.

## Consequences

- **An adjustment has no VAT invoice behind it.** A top-up carries a Stripe
  invoice; a goodwill credit has no payment and therefore no sale to invoice.
  The UI says so at the point of use. How these are treated in the accounts is a
  question for the bookkeeper, not the software — flagged rather than assumed.
- Ops can now move money onto a customer account. The cap, the mandatory reason,
  the super-admin restriction and the audit entry are what make that safe; none
  of them should be relaxed without replacing them with something else.
- Credits appear on the customer's own wallet page as "Adjustment", with no
  explanation of who applied it or why. If that proves confusing, the reason is
  in the audit trail and could be surfaced.
