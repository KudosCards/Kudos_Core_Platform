# ADR 0027 — Bulk send: one design to many existing contacts

Status: **accepted**
Date: 2026-07-23

## Context

User feedback: "Improve bulk sending — select multiple contacts, design one card, send to everyone
with each recipient's name and address populated automatically."

The platform already had two order paths:

- **Manual batch order** (`POST /batch-orders`) — check out a set of *already-approved occasions*.
  Powerful, but it assumes you've been through the calendar/approvals workflow first.
- **Quick send** (`POST /batch-orders/quick-send`, and `quickSendMany` behind the guest basket) —
  design a card and type in *one new recipient's* details. Great for a one-off to someone not yet
  in your contacts, but it *creates* a recipient from typed-in fields every time.

Neither fits the common tuition-centre job: "send this one card to these thirty pupils I already
have on file." Doing it today meant thirty trips through quick send, re-keying an address that's
already stored. That's the gap this closes.

## Decision

Add a **bulk send** path: one saved design + a set of **existing** contacts → one order → one
payment, with every card addressed automatically from its contact's stored record.

### API — `POST /batch-orders/bulk-send`

Body: `{ savedDesignId, recipientIds: string[], postageClass, occasionType? }`.

`BatchOrdersService.bulkSend`:

1. **Cap check up front.** Reject if `recipientIds.length > batchOrderMaxSize` *before* creating
   anything, so an over-cap request never leaves orphaned occasions behind. (`create()` re-checks
   it as the real guard — this early check is purely to fail clean.)
2. Validate the design belongs to the account.
3. Fetch every contact, account-scoped. A short count → **404** (an id from another account, or a
   deleted one) — we fail rather than silently drop contacts the sender expected to reach.
4. **Require a mailable address.** A card can only be posted to a contact with a complete, valid UK
   address (line 1 + city + a postcode matching the shared regex). Any without one → **400** that
   *names them*, so the sender knows exactly who to fix rather than getting a vague rejection.
5. For each contact, create an `approved` one-off occasion carrying the design (source
   `one_off_campaign`, dispatch `asap`), then hand the lines to the existing `create()` — so the
   money path (pricing, the atomic approved→queued transition, the per-order cap) is **identical**
   to every other order, not a parallel copy. Each line's address comes off the contact's record.

The returned draft is checked out through the same `POST /batch-orders/:id/checkout` as everything
else. This mirrors `quickSendMany` deliberately — the two share the shape of "build approved one-off
occasions, then create() one order" so they can't drift.

### Web — `/send`

A new **"Bulk send"** page (added to the sidebar under *Send cards*). Entry point: the Recipients
page's existing multi-select now shows a **"Send a card →"** action whenever contacts are ticked,
linking to `/send?recipients=<ids>`. The page:

- pulls each selected contact's record and the account's saved designs;
- lets the sender pick **one** design and a postage class;
- lists the contacts, flagging any **without a postal address** (with a link to add one) and
  excluding them from the sendable count and the price;
- shows a live estimate and pays via the standard Stripe checkout.

Reaching `/send` with no contacts selected shows a friendly pointer back to Recipients.

## Consequences

- **No new entitlement.** Bulk send is naturally bounded by the existing `batchOrderMaxSize` cap
  (20 across plans today), so it needs no new gate — it's available to every plan.
- Names and addresses are never re-keyed; they come straight from the contact record, which is the
  whole point of the feature. Keeping a contact's address current now directly benefits sending.
- Contacts without an address are surfaced, not silently skipped — the sender stays in control of
  who actually receives a card.
- Auto-personalising the card *face* with each recipient's name (the `{name}` merge token, still
  unimplemented) remains out of scope here; this ADR covers auto-*addressing*. That merge-render
  work is tracked separately.
