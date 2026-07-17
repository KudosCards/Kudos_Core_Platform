# ADR 0013 — Auto-send: approve once, we order, pay, and post on time

Status: accepted
Date: 2026-07-17

## Context

The product promise is "as automated as we can make it": a tuition centre shouldn't have to
manually assemble a batch order, type each address, and pay every time a birthday comes round. The
scheduler (birthdays → `pending_approval`), per-card pricing (Phase 6), and the account wallet
(Phase 8) were all built as the groundwork for this. Phase 9 joins them into hands-off sending.

The one genuine fork was **how hands-off** — specifically, whether a human approves each card before
money leaves the wallet. Fully auto-approving (pick a default design, send with zero human touch)
is maximally automated but moves money unattended and a wrong or duplicate send isn't caught by a
person first. Confirmed with the business: **approve-then-auto**. A human still approves every card
in the existing Approvals queue (design + go-ahead); automation takes over only after that.

## Decision

- **Auto-send is an opt-in made at approval, per occasion.** `POST /occasions/:id/approve` gains
  `dispatchOption` (`asap` default | `auto_send`) and `postageClass`. `asap` behaves exactly as
  before (manual checkout). `auto_send` is stored on the occasion (`Occasion.dispatchOption`,
  `Occasion.postageClass`) and re-times the `dispatchDate` to the postage class.
- **Two gates enforced at approval, up front — not discovered later by the cron:**
  1. the plan's `autoSendEnabled` entitlement (free plans are refused, 403);
  2. the recipient has a complete postal address (else 400) — auto-send can't prompt for one.
- **Dispatch timing per postage class.** `POSTAGE_LEAD_DAYS = { first_class: 3, second_class: 5 }`
  (Kudos HQ turnaround + Royal Mail delivery). `dispatchDate = occasionDate − leadDays`; the cron
  acts once `dispatchDate <= today`, so the card is posted to arrive before the date.
- **A daily cron (`AutoSendService`, 7am — after the 6am birthday scheduler) does the work.** For
  every `approved` + `auto_send` occasion whose dispatch date has arrived, it creates a one-card
  order from the recipient's **stored** address and approved design, debits the account wallet, and
  hands it to fulfilment — reusing the exact same `settleFulfillment` step as manual checkout, so an
  auto-sent card is indistinguishable downstream.
- **Each occasion is processed in a single Serializable transaction.** Consuming the occasion
  (`approved → queued`, status-guarded), creating the order, debiting the wallet
  (`WalletService.debitAndSettleOrder`, extracted so interactive and automated payment share one
  definition), and settling fulfilment all commit together or not at all. Insufficient funds — or
  any failure — rolls the whole thing back, leaving the occasion `approved` for the next run or
  manual handling, and is recorded as an audited `auto_send_skipped` with a reason. A run never
  half-sends.
- **Idempotent + race-safe.** The status-guarded consume means two overlapping runs (or a manual
  checkout mid-run) can't double-send: whichever commits first wins, the other sees the occasion
  already gone and skips.
- **Plan re-checked at send time.** A downgrade between approval and dispatch is honoured — the cron
  re-verifies `autoSendEnabled` before charging, so a lapsed plan quietly stops auto-sending rather
  than charging anyway.
- **Ops-only manual trigger** `POST /auto-send/run` (PlatformAdminGuard), the same job the cron
  fires, for on-demand runs and testing. It acts across every account, so it is not customer-facing.

## Alternatives considered

- **Fully hands-off (auto-approve with a default design).** Rejected by the business for now: money
  leaving the wallet with no human having seen the specific card is the scarier failure mode, and it
  needs a default-design model that doesn't exist yet. The schema doesn't preclude adding it later.
- **Auto-send flag on the account or recipient, not the occasion.** Rejected: per-occasion opt-in at
  the moment of approval is the most explicit and granular — the human deciding "send this one
  automatically" is the same human approving it.
- **Charging a saved card off-session instead of the wallet.** Deferred: the wallet is already built
  and needs no Stripe round-trip mid-cron (which off-session SCA could interrupt). Saved-card funding
  is a possible later option for accounts that prefer not to pre-load a balance.
- **Two transactions (create order, then pay).** Rejected: a create-then-fail-to-pay would consume
  the occasion and strand an unpaid order. One atomic transaction keeps insufficient-funds a clean
  no-op.

## Consequences

- The customer's job shrinks to approving cards; ordering, payment, and dispatch timing are handled.
- A wallet that runs dry degrades gracefully: affected occasions stay approved and auditable, and
  resume automatically once the balance is topped up — no lost sends, no surprise failures.
- Auto-sent and manually-paid orders are identical to fulfilment and reporting (only
  `BatchOrder.paymentMethod` / the `auto_send` line differs), so ops needs no new surface.
- The wallet's `debitAndSettleOrder` and the shared `runSerializable` helper are now the single
  definitions used by both interactive and automated payment — no divergence risk.
- Auto-approval with default designs remains a clean future addition on top of this, if the business
  later wants a fully hands-off tier.
