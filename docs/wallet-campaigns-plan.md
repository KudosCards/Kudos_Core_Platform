# Wallet campaigns — implementation plan

A super-admin marketing tool: credit £X to the wallet of every new account that
signs up inside a chosen date window.

Written after a read of the wallet, signup, guest and admin paths. Every design
choice below cites the code it rests on, because two of them changed once the
code was actually read.

## What already exists

This is mostly assembly. `WalletService.adjustBalance`
(`apps/api/src/wallet/wallet.service.ts:295`) already solves the hard parts of
crediting a wallet with no payment behind it:

- **Serializable** via `runSerializable`, so a credit cannot interleave with a
  concurrent order payment and compute from a stale balance.
- **Idempotent** on `reference = adjustment:${requestId}`, checked as
  `findFirst({ accountId, reference })` — _per account_. A campaign id used as
  the reference therefore gives exactly-once-per-account for free.
- **Audited** with actor, amount and reason, deliberately awaited rather than
  fire-and-forget.
- **Refuses to take a balance below zero.**

Balance is `SUM(amountMinor)` over an append-only ledger
(`wallet.service.ts:350`), so a credit cannot drift from the record. The
money-route guard pattern is `@UseGuards(PlatformAdminGuard, SuperAdminGuard)`
(`admin.controller.ts:202`). Bounded fan-out is `mapWithConcurrency`; wall-clock
bounding is `common/fetch-budget.ts` (ADR 0238).

**One consequence of the ledger's design worth stating early: no grants table is
needed.** A campaign's grants _are_ the ledger rows carrying
`reference = campaign:<id>`. "How many accounts, how much spent" is one
aggregate, and it can never disagree with the balances it produced.

## Decisions

### D1 — Eligibility: the signup path only

> **Superseded in part.** The table below reads the _creation sites_ correctly,
> but the plan then intended to tell the two apart at query time with
> "has an owner membership and holds no claim token". That works for an
> unclaimed guest and fails for a claimed one: a claim nulls the token and
> renames the account, leaving it indistinguishable from a registration.
> `Account.origin` is now recorded at creation instead. See ADR 0240.

There are two paths that create an `Account`:

| path                         | what it is                                               |
| ---------------------------- | -------------------------------------------------------- |
| `accounts.service.ts:61`     | a real signup — `Account` + owner `Membership`           |
| `guest-orders.service.ts:70` | a "Guest" account minted mid-checkout with a claim token |

Only the first is a signup. A guest account exists because someone is already
buying; crediting it either does nothing (the order is priced) or silently
discounts an in-flight purchase. Invites create a `Membership`, not an
`Account`, so a colleague joining an existing account is excluded with no work.

A guest who later claims (`guest-claim.service.ts:53`) is **not** credited in v1.
They are a buyer who acquired a login, not a signup, and the campaign's story is
"welcome, here is something to start with".

### D2 — Delivery: a sweep, with an eager credit at signup

The sweep is the primitive: select accounts whose `createdAt` falls in the
window, credit each one. Idempotent, re-runnable, and able to serve a window
that has already started.

`AccountsService.signup` also credits eagerly, so a new customer sees the money
immediately rather than up to an hour later.

**A worry raised during scoping, and why it was wrong.** Requiring a verified
email (D7) looked like it would make the eager hook dead code, on the assumption
that an address is unverified at signup. It is not. `register/page.tsx:81`
records the actual flow: `supabase.auth.signUp` returns **no session** when
confirmation is required, so the browser shows "check your email" and
`POST /accounts` is never called. The account is created only after the customer
confirms and a session exists. **By the time `signup()` runs, the address is
already confirmed** — so `user.emailVerified` is true in the ordinary flow and
the eager credit works.

The sweep is still not optional. `opsActivity.accountSignedUp` — the existing
call at the end of signup — wraps everything in `try/catch` and swallows errors
so that "a notification problem can never cost us a signup"
(`ops-activity.service.ts:279`). A credit attached to that path inherits the same
silence. The sweep is what makes a missed credit recoverable, and it is the only
thing that can serve a retroactive window.

Scheduled hourly, on the `@Cron` pattern the dispatch reminder already uses.

### D3 — A new `campaign` ledger entry type

`wallet-client.tsx:11` maps entry types to customer-facing labels and never
renders `reference`. Reusing `adjustment` would show a customer "Adjustment"
against money we gave them as a welcome gift — the opposite of the intended
effect, on a feature whose entire purpose is goodwill.

Adding `campaign` to `WalletEntryType` also separates marketing spend from
goodwill corrections in the ledger, which D8 depends on.

Surface: the Prisma enum, `walletEntryTypeSchema`
(`packages/shared-types/src/enums.ts:139`), and `ENTRY_LABELS`. That last one is
a `Record<WalletEntryType, string>`, so **the compiler forces the label to
exist** — a customer cannot end up looking at a blank.

Migration note to verify rather than assume: Postgres will not let a newly added
enum value be _used_ in the same transaction that adds it, so this is two
migration steps, not one.

### D4 — Caps, enforced where they cannot be raced

Two bounds, because they fail differently:

- **Per-account amount**, £1–£50. A card is £2.50, so £50 is twenty cards —
  far beyond a welcome gift and comfortably inside a mistyped-decimal guard.
  Same shape as `AdjustWalletDto`'s existing £1,000 bound.
- **Campaign budget**, required, no default. £5 × unlimited signups is
  unbounded liability, and "we will keep an eye on it" is not a control.

The budget is checked **inside the same serializable transaction as the credit**,
by aggregating `SUM(amountMinor) WHERE reference = campaign:<id>`. Anything
outside that transaction lets two concurrent signups both take the last £5.

On exhaustion the campaign moves to `exhausted` and notifies all admins via
`notifyAllAdmins`, keyed on the campaign id so it says so once. A campaign that
silently stops is a campaign nobody knows has stopped.

### D5 — One campaign credit per account, ever

Not per campaign. Two campaigns with overlapping windows would otherwise both
match an account created in the overlap, and that is an ops mistake rather than
an intent — nobody plans to pay a welcome gift twice.

It costs nothing to enforce, because an account can only be "new" once: the
check is for any existing `campaign:` reference on that account, not just this
campaign's. If stacking is ever wanted it becomes a deliberate change with a
reason attached.

### D6 — No expiry in v1, and the liability made visible

ADR 0012 records no wallet refunds or withdrawals: a credit is permanent and
spendable forever. A marketing credit that never expires is a standing liability
on every account that never converts, and the ledger has no expiry concept to
build on — adding one means a scheduled negative sweep and a customer-visible
"expires on" date, which is its own piece of work.

Deferred deliberately. The cheap mitigation ships instead: **total campaign
credit issued** as a figure on the admin overview, so the liability is a number
someone can see rather than one nobody has computed. Revisit when that number is
large enough to matter.

### D7 — Only credit a confirmed address

`accounts.controller.ts:32` passes `user.unverifiedEmail`, and
`auth/types.ts:11` says plainly to use `verifiedEmailFromToken` "where the
address decides an outcome". With a campaign live, the address decides £5.
One membership per user is enforced, but N addresses give N accounts.

Two sources, because the two paths have different context:

- **Eager credit**: `user.emailVerified` from the request's verified JWT. Free,
  no outbound call.
- **Sweep**: no request, so no JWT. Authoritative lookup via
  `supabaseAdmin.auth.admin.getUserById(ownerUserId)` — the precedent is
  `admin-team.service.ts:117`.

That makes the sweep do one outbound call per candidate account, so it is
bounded: `mapWithConcurrency` for fan-out and a wall-clock budget from
`common/fetch-budget.ts`, exactly as ADR 0238 required of every other paged
upstream pull. Running out of budget leaves the remaining accounts for the next
hourly run — they are still in-window, so nothing is lost.

### D8 — Do not attribute campaign spend to orders; report it separately

`admin.service.ts:288` computes `revenueMinor` from `BatchOrder.totalMinor` for
revenue-counting statuses, **regardless of payment method**. An order paid from a
campaign credit counts as revenue with no cash behind it. Already true of
goodwill adjustments; a campaign scales it — £5 × 200 signups is £1,000 of
phantom revenue.

**Per-order attribution is not possible and should not be attempted.** Money in
a wallet is fungible: `debitAndSettleOrder` writes a single negative `charge`
with no record of which credits funded it, and the ledger's defining property is
that balance is a plain SUM. Attribution would mean FIFO lot accounting — a
rewrite of the thing that makes the wallet trustworthy, to produce a number that
would still be a guess.

So: report the truth next to the number instead. `campaignCreditIssuedMinor`
joins `AdminOverview` as a contra figure beside revenue, with a sentence saying
revenue includes orders funded by campaign credit and here is how much credit was
issued. Honest, cheap, and it doubles as D6's liability figure.

### D9 — A pause stops crediting; the window still governs

Eligibility is the window, not the running state. A paused campaign credits
nobody while paused; on resume the sweep picks up accounts created during the
pause, because they are still in-window. No extra state, and the least
surprising behaviour to explain to whoever paused it.

## Data model

```prisma
enum WalletCampaignStatus {
  draft
  live
  paused
  exhausted
  ended
}

model WalletCampaign {
  id              String               @id @default(uuid())
  name            String
  /// Per-account credit in pence. Bounded £1–£50 at the DTO.
  amountMinor     Int                  @map("amount_minor")
  startsAt        DateTime             @map("starts_at")
  endsAt          DateTime             @map("ends_at")
  /// Hard ceiling on total credit. Checked inside the crediting transaction.
  budgetMinor     Int                  @map("budget_minor")
  status          WalletCampaignStatus @default(draft)
  createdByUserId String               @map("created_by_user_id")
  createdAt       DateTime             @default(now()) @map("created_at")
  updatedAt       DateTime             @updatedAt @map("updated_at")

  /// The sweep's own query: live campaigns whose window is open.
  @@index([status, startsAt])
  @@map("wallet_campaigns")
}
```

Plus `campaign` on `WalletEntryType`. No grants table — the ledger is the record.

## Phasing

Each phase is independently mergeable and leaves the platform working. All four
are built; what each one actually shipped is recorded in ADR 0240, including the
two things this plan got wrong.

**Phase 1 — the ledger can express a campaign.** `campaign` entry type across
Prisma, `shared-types` and `ENTRY_LABELS`; two-step enum migration. No behaviour
yet. Ships the customer-facing label before anything can create one.

**Phase 2 — the credit path.** `WalletCampaign` model.
`WalletService.creditCampaign`: serializable, budget check and one-per-account
check inside the transaction, audited, verified-address required. Unit + e2e,
including two concurrent credits against a budget with room for one.

**Phase 3 — delivery.** The hourly sweep, bounded by concurrency and wall-clock,
plus the eager credit in `signup`. Exhaustion notifies admins. E2e for
retroactive windows, a paused-then-resumed window, and a budget hit mid-sweep.

**Phase 4 — the ops surface.** A super-admin panel on `/admin` beside the
existing setup panels: create, pause, resume, end, and a live readout of accounts
credited and budget remaining. `campaignCreditIssuedMinor` on the admin overview
with its contra-figure sentence.

Two rules came out of building it that this plan had not thought about, both
recorded in ADR 0240: the amount and the window are frozen once a campaign leaves
draft, and an exhausted campaign restarts by having its budget raised rather than
by being set live again.

## Tests and guards

Beyond per-phase unit and e2e coverage, three guards in the repo's existing
style:

- **A campaign credit is never larger than the campaign says.** A source scan
  would be weak here; a property test over the credit path is not.
- **Every crediting path goes through `creditCampaign`.** A scan in the shape of
  `no-bare-fetch`, so a future path cannot write a `campaign` ledger row directly
  and skip the budget and one-per-account checks.
- **The budget cannot be exceeded under concurrency.** An e2e that fires two
  credits at a budget with room for one and asserts exactly one lands.

Mutation-test each guard, per the standing practice.

## What we are deliberately not building

- **Expiry** (D6) — deferred with the liability made visible instead.
- **Guest and claimed-guest eligibility** (D1) — a buyer is not a signup.
- **Per-order attribution of campaign spend** (D8) — impossible without lot
  accounting, and the contra figure is the honest answer.
- **Stacking campaigns** (D5) — one credit per account until someone asks for
  the opposite and says why.

## Open question

**Signup rate.** It decides whether the sweep is a trivial loop or needs paging
alongside its budget. The design bounds it either way, but the numbers set the
concurrency limit and the budget. A rough weekly signup count is enough.
