# 0240 — Money given to a stranger, on a schedule

## Status

Accepted — implemented across four phases. Marketing wallet campaigns: "sign up
in October and get £5 free credit to send your first card". The design is
recorded in `docs/wallet-campaigns-plan.md`; this records what building it
changed, and what it cost to be sure.

## Context

Everything else that moves money on this platform has a person on one side of
it. A top-up is a customer paying. A charge is a customer buying. A hand-applied
adjustment (ADR 0103) is an operator choosing one account and typing a reason.

A campaign has nobody on either side. It is a rule — an amount, a window, and a
budget — that pays out to whoever happens to sign up, hours after the operator
who wrote it has gone home. Every guarantee therefore has to be structural,
because there is no one there to notice.

Four of them, all enforced in `WalletService.creditCampaign` inside a single
serializable transaction: the account was created inside the window, its address
is confirmed, it has never had a campaign credit before, and the campaign's
budget has room. Anything checked outside that transaction lets two concurrent
sign-ups both take the last £5, which is the failure this design exists to make
impossible rather than unlikely.

## The two things the plan got wrong

### 1. "Not a guest" was not a question the database could answer

The plan identified the two creation paths correctly — a registration
(`accounts.service.ts`) and a guest account minted mid-checkout
(`guest-orders.service.ts`) — and then proposed to tell them apart at query time
with "has an owner membership and still holds no claim token".

That predicate excludes an _unclaimed_ guest exactly, and a claimed one not at
all. Claiming a guest account nulls both `claim_token` and
`claim_token_expires_at` and renames the account; afterwards it is
indistinguishable from a registration by inspection. A claimed guest would have
been credited.

**Fixed by recording the answer instead of inferring it.** `Account.origin` is
required with no default, so the compiler asks the question at each creation
site rather than letting a third path inherit whichever default suited its
author. There are exactly two sites, and they answer `signup` and `guest`.

The backfill is the interesting part, because the history it has to classify is
the history that lost the distinction. Four rules, in order:

| rule | how it knows                                                         |
| ---- | -------------------------------------------------------------------- |
| 1    | still holds a claim token — an unclaimed guest, unambiguously        |
| 2    | no membership at all — `signup()` writes one in the same transaction |
| 3    | first order predates first membership — a _claimed_ guest            |
| 4    | everything left — a registration                                     |

Rule 3 is the one that recovers what rules 1 and 2 cannot see. Guest checkout
creates the order and the claim creates the membership days later; a
registration is the other way round by construction, because the membership
exists before any order can.

### 2. A promise cannot be edited

The plan gave campaigns a `draft` state and said nothing about what may change
afterwards, which reads as "anything". It cannot be.

"Sign up in October and get £5" is a promise made to everyone in that window,
and one credit per account **ever** means an early sign-up can never be topped
up to match a later raise. Raising the amount mid-campaign therefore does not
raise the offer; it splits the customers into two prices with no way back.

So the amount and the window are frozen the moment a campaign leaves draft.
Changing the offer means ending the campaign and starting another — which is
also what an accountant would want, because the two offers then have two
budgets and two lines in the ledger.

The name and the budget stay editable, because neither is a promise made to a
customer: one is a label, and the other is a ceiling we set ourselves. Raising
the budget on a campaign that has already stopped at it puts the campaign back
to `live`, which is what an operator topping it up means. The hourly sweep then
picks up everyone who was passed over in the meantime, because they are still
in-window.

`exhausted` is not reachable by an operator at all. Only spending the budget
produces it, and the way back is to raise the budget — an instruction that says
what actually changed. A refused `exhausted → live` says so in those words
rather than just refusing.

## What is not attributed, and why that is the honest answer

`admin.service.ts` computes `revenueMinor` from `BatchOrder.totalMinor` for
revenue-counting statuses, **regardless of how the order was paid**. An order
settled from a campaign credit is revenue with no cash behind it.

Per-order attribution is not possible and was not attempted. Money in a wallet
is fungible: `debitAndSettleOrder` writes a single negative `charge` with no
record of which credits funded it, and the ledger's defining property (ADR 0012)
is that a balance is a plain SUM. Attribution would mean FIFO lot accounting —
rewriting the thing that makes the wallet trustworthy, to produce a number that
would still be an allocation convention rather than a fact.

`campaignCreditIssuedMinor` joins the admin overview as a contra figure instead,
with the sentence that makes it readable: revenue above includes orders paid
with this credit. It doubles as the liability figure, because a wallet credit
never expires — every penny issued and not yet spent is still owed.

## Consequences

- A third account-creation path fails to compile until it says what it is.
- A campaign that starts or stops giving money away files an alert to every
  operator. Both are keyed on the campaign id, so neither can be filed twice.
- Two guards make the invariants mechanical rather than remembered:
  `campaign-credit-single-path.spec.ts` pins the short list of files allowed to
  write the wallet ledger at all, and holds `creditCampaign` as the only one
  that may write a `campaign` row — a second path would be correct-looking, pass
  its own tests, and have none of the four checks. The paren-matching scan there
  exists so a `where: { type: "campaign" }` on a _read_ is not mistaken for a
  write; a guard that cries wolf gets deleted rather than obeyed.
- `admin-mutations-guarded.spec.ts` now covers a curated list of
  platform-settings controllers rather than one file. The list is curated on
  purpose: most ops mutations _are_ ops work — advancing a fulfilment job,
  closing a ticket — and what belongs here is the surface that acts on every
  tenant at once. The reason written next to each entry is what makes adding one
  a decision rather than an oversight.
- Every rule above was mutation-tested: the guard reverted, the failure
  observed, the guard restored. The two that a first attempt did _not_ catch —
  the sweep's `status: "live"` filter and its guest filters, both absorbed by
  `creditCampaign` downstream — were fixed by asserting `summary.skipped`, which
  is the difference between "never a candidate" and "a candidate we declined".

## Still deferred

- **Expiry** (plan D6). The ledger has no expiry concept; adding one means a
  scheduled negative sweep and a customer-visible date. The liability is a
  visible number in the meantime. Revisit when it is large enough to matter.
- **Stacking campaigns** (plan D5). One credit per account, ever, until someone
  asks for the opposite and says why.
