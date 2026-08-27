# 0112 — Buyer-facing order detail: name, tracking & message-page parity

## Status

Accepted

## Context

ADR 0109 gave the **ops** order-detail view real per-card progress and tracking.
The **buyer's** own order page (`/orders/[id]`) never got the same treatment — it
was effectively a payment + VAT-receipt screen. A journey review found three gaps
that left the person who paid with less visibility than staff:

1. **No recipient name.** Each card line rendered its shipping **city + postcode**
   only. The name wasn't even in the payload (`orderRecipientSchema` carries
   `recipientId` but no name), so a buyer who sent 50 cards saw 50 rows of
   postcodes with no way to tell whose card was whose.
2. **No tracking on the page.** The dispatch email carries a Royal Mail "track it"
   link, but the order page a buyer _returns to_ didn't — the stored
   `trackingReference` was never surfaced there.
3. **No link to the digital message page.** The QR-linked message page
   (`/r/:slug`, ADR 0047) existed but the order never connected to it.

## Decision

### 1. A dedicated, enriched single-order read

`findOne` gains `ORDER_DETAIL_INCLUDE`: each `orderRecipient` also pulls its
`recipient` (name), `fulfillmentJob` (status + `trackingReference`) and
`messagePage` (slug). The service flattens these onto each line
(`recipientFirstName`, `recipientLastName`, `jobStatus`, `trackingReference`,
`messagePageSlug`). Contract in `@kudos/shared-types` as `batchOrderDetailSchema`.

**The orders _list_ stays lean.** The heavier include is used only by `findOne`;
the list still uses `ORDER_RECIPIENTS_INCLUDE` (it only reads
`orderRecipients.length`), so we don't fan out relations across every list row.

### 2. The buyer's page reflects fulfilment

Each line now leads with the recipient's name, keeps city/postcode + postage +
price as the secondary line, shows a **Track delivery** link once posted, and a
**View digital message** link to `/r/:slug`. No street address is added — the
buyer already owns their recipients' addresses, but the line stays name-first for
scanability; the address remains on the recipient record.

### 3. One tracking-URL source of truth

`royalMailTrackingUrl` moves to `@kudos/shared-types`, shared by the dispatch
email and the buyer's page (the API shipping module re-exports it, so existing
callers are unchanged).

### 4. Sidebar cleanup (drive-by)

The member sidebar's "Checkout" item is removed. It pointed at `/batch-orders`,
which the header **basket indicator** already owns (badged with the unfinished-
order count). "Checkout" as a permanent, usually-empty nav label was redundant
and confusing.

## Consequences

- The order page becomes a "where are my cards" view, not just a receipt — the
  most common reason a buyer returns to it, reusing tracking data already stored.
- No schema change — read-side enrichment over existing relations.
- The `createdByUserId` nullability drift between the Prisma model (`string | null`)
  and the zod contract (`string`) surfaced here; the API return type is derived
  from Prisma (as `BatchOrder` already is), and the web keeps the zod type at its
  fetch boundary, matching the existing pattern rather than widening the contract.

## Alternatives considered

- **Enrich `ORDER_RECIPIENTS_INCLUDE` for every read.** Rejected: it would fan
  relations across every orders-list row for data only the detail uses.
- **Add street address to the line.** Unnecessary — name is the scannable key;
  the address lives on the recipient record and the audited fulfilment export.
