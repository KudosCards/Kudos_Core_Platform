# 0170 — The orders list is a summary, not orders plus their cards

## Status

Accepted — implemented.

## Context

A customer sending via segments told us the scheduling on their order page was
confusing. Fixing that (ADR 0166's sibling work, PRs #341–#343) left one
question unanswered: the orders **list** still gave no hint that an order was
scheduled at all. It showed the date the order was placed and a status pill, so
someone with a card going out in November saw "Paid" and nothing else — the one
question they came to the page with.

The list could not answer it, because it never fetched the dates. Its read was:

```ts
const ORDER_RECIPIENTS_INCLUDE = { orderRecipients: true } as const;
```

No occasion join, so no `dispatchDate` anywhere on the row.

Looking at what that read *did* fetch turned up something worse. The page uses
exactly two things from those recipients: `.length`, and `.status` for the
header pill. Everything else was fetched, serialised and sent for nothing:

| | Shipped | Used |
| --- | --- | --- |
| Per recipient row | 636 bytes | 19 bytes |
| 50 orders × 5 cards | 186 KB | ~5 KB |
| 50 orders × 76 cards | **2,391 KB** | ~5 KB |

There is no response serialiser on this endpoint — raw Prisma rows go out — so
every row also carried `shippingAddressLine1`, `line2`, `city` and `postcode`.
The customer owns that data, so this was never a disclosure problem. But the
**ops** view of the same orders already withholds addresses on principle:

> Deliberately name + occasion + postage + status — never the street address
> (that stays behind the audited fulfilment export, mirroring the queue's data
> minimisation).
> — `adminOrderLineSchema`

The internal view minimised. The customer-facing list did not, by accident
rather than by decision.

## Decision

The orders list row carries a **summary of an order**, never its cards:

- `cardCount` — replaces `orderRecipients.length`.
- `cardStatusCounts` — a tally, replacing an array of every card's status.
  `orderHeaderStatus` now reads the tally, and the order *page* tallies its own
  lines into the same shape, so both screens still answer from one function.
- `sendSchedule` — `summariseSendSchedule` minus its `dates` array: how many
  distinct dates are ahead, the first and last, and the to-come / gone / undated
  counts. Enough for `describeSendSchedule` to write the same sentence the order
  page shows.

The Prisma read is a `select`, not an `include`, listing the order's scalar
columns explicitly so a new column cannot silently join the payload. Per card it
takes `status` and the occasion's `dispatchDate`, and nothing else. The occasion
join is one extra batched query — not one per row — and it is what lets the list
signpost a scheduled order at all.

The `dates` array is deliberately dropped on the wire. An order can hold
seventy-odd distinct birthdays and the readout only ever renders "how many
dates, first and last"; shipping the array would put kilobytes back on a row to
write one sentence.

## Consequences

A list row is now a **fixed ~634 bytes regardless of how many cards the order
holds**. For a bulk sender's fifty 76-card orders that is 2,391 KB → 31 KB, a
77× reduction, and the page gains the scheduling line it never had.

`GET /batch-orders` no longer returns `orderRecipients`. That is a breaking
response change, taken deliberately after confirming the blast radius: the only
consumer is our own `orders/page.tsx`. The API-key surface reaches exactly two
endpoints — `GET /integrations/me` and `POST /integrations/contacts` (ADR 0134)
— so no Zapier or CRM integration can see this route, which sits behind
`MembershipGuard`. The order *detail* read is untouched, and `bulk-send` /
`quick-send` still return the created order with its recipients (both callers
only read `.id`, but that is a bounded single-order payload and out of scope
here).

An e2e asserts on the raw JSON that no address appears on the list, so re-adding
an `include` at any nesting depth fails there rather than shipping. It was
verified to fail by putting the recipients back on the response.

Two things this surfaced and fixed on the way:

- `batchOrderSchema.createdByUserId` was declared `z.string().uuid()` against a
  nullable column. A guest one-off purchase (ADR 0025) has no user behind it.
  Nothing had caught it because the API returns Prisma rows rather than parsing
  through the schema, so the lie only ever existed as a type. Now nullable.
- A code comment pointed at `docs/adr/0109-order-detail.md`, which does not
  exist — 0109 is the *ops* order detail. The claim that "the list stays lean"
  lived only in that comment and was not true. It now points here.
