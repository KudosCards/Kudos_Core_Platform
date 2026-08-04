# 0107 — Occasion reconciliation for segment sends

## Status

Accepted

## Context

ADR 0106 shipped "send to a segment" by seeding the bulk-send composer from a
segment's people, and explicitly accepted one gap: for an **occasion-mode**
segment (e.g. "birthdays this month"), the send goes out as a fresh
`one_off_campaign` order while the person's **natural** occasion (their actual
birthday) stays in approvals — so they could receive two cards unless a human
skips the natural one. This ADR closes that gap.

The hard constraint is timing. `bulkSend` creates a **draft** order; the card is
only actually sent after payment settles (`settleFulfillment`, run inside the
Stripe-webhook or wallet-debit transaction). So the natural occasion must **not**
be consumed at draft time — a sender who abandons checkout would then get
neither the segment card nor their birthday card. Reconciliation has to be atomic
with payment.

## Decision

A segment send **supersedes** the recipient's matched natural occasion, and that
occasion is consumed only when the order is paid.

1. **A `supersedesOccasionId` self-link on `Occasion`** (nullable, `onDelete:
   SetNull`). On the campaign occasion created for a bulk-send line it points at
   the natural occasion this send stands in for; the reverse relation
   `supersededBy` lets surfaces show "handled by a bulk send". One additive
   migration, no backfill.

2. **The composer resolves + carries the match; the API validates it.** For an
   occasion-mode segment, `GET /segments/members` returns a parallel
   `reconciliations: [{ recipientId, occasionId, occasionType, occasionDate }]`
   (the soonest _sendable, non-campaign_ occasion per member, via the same
   `occasionMatch` predicate). The composer sends the chosen pairs back as
   `BulkSendDto.reconcile`. `bulkSend` re-validates each pair — the occasion must
   be on the account, belong to that recipient, be natural (not
   `one_off_campaign`), and still sendable — and silently drops anything else
   (including entries for recipients trimmed from the send) rather than failing
   the whole order. Surviving pairs set `supersedesOccasionId` on the campaign
   occasion.

3. **Consume at settlement, status-guarded and idempotent.** `settleFulfillment`
   already moves the order's recipients to `queued` and mints fulfillment jobs
   when payment lands. It now also collects the `supersedesOccasionId`s of the
   order's campaign occasions and marks those natural occasions `skipped` —
   guarded to still-sendable statuses (`scheduled` / `pending_approval` /
   `approved`) so an occasion already sent by another route is never un-done, and
   idempotent so a redelivered webhook or retried wallet debit is a no-op.

4. **Default-on, opt-out in the composer.** When seeded from an occasion-mode
   segment, the composer shows a checked-by-default "Mark these birthdays as
   handled so they aren't sent again" toggle. Unchecking it sends no `reconcile`,
   preserving ADR 0106's behaviour (send an early card _and_ keep the natural
   one). The reconcile set is scoped to the contacts actually being sent to, so
   trimming or adding contacts in the composer needs no extra bookkeeping.

## Consequences

- The double-send ADR 0106 accepted no longer happens by default: sending to
  "birthdays this month" consumes each matched birthday at the moment payment
  settles, and it drops out of approvals/auto-send.
- Reconciliation rides the existing money path unchanged — no new settlement
  code, and the same atomic transaction that takes payment consumes the occasion,
  so the two can't diverge.
- `skipped` is reused as the consumed state; the `supersededBy` link records _why_
  (a bulk send stood in for it), which a later calendar/approvals surface can show
  as "sent via a bulk send" rather than a bare "skipped". Not built here.
- Purely additive on top of ADR 0106 — one nullable column + FK, no data
  migration.

## Alternatives considered

- **Consume at draft creation.** Simpler to reason about, but an abandoned
  checkout would wrongly skip a real birthday — the sender pays nothing and the
  recipient gets nothing. Rejected outright.
- **A new `superseded` occasion status** instead of reusing `skipped`. Cleaner
  semantics, but a schema enum change rippling through every occasion query and
  UI for a distinction the `supersededBy` link already captures. Deferred.
- **Re-resolve the segment server-side at send time** and skip all matches,
  rather than carrying explicit pairs from the composer. Rejected: it would skip
  occasions for people the sender _removed_ from the order, and couldn't tell a
  trimmed contact from a kept one.
