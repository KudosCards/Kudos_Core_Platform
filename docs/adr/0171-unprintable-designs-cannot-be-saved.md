# 0171 — A design that can't be printed can't be saved

## Status

Accepted — implemented.

## Context

ADR 0166 reserved the bottom 30 mm of the card back, because that strip is
physically pre-printed on the stock with the Kudos logo and the QR code a
recipient scans to reach their digital message. The print engine clips it, so
the QR can never be covered again.

What 0166 did **not** do was stop a customer putting content there. It added
warnings — the editor shades the band and warns, the pre-send check shows a
notice — and then let the send proceed. Every one of those was advisory:

- `canPay` in the bulk composer never looked at clipping at all.
- The API never looked at it on any order path.
- The print engine clipped silently, and nothing after payment ever mentioned it.

So a design could pass every check we had, take money, and print with the
customer's content missing. That is exactly what happened to the 76-card order
0166 describes: a grid of partner adverts, the bottom row of which fell in the
strip. Those partners were promised placement by our customer.

The proposal on the table was to notify someone after payment. That is the wrong
shape of fix — it accepts the bad state and adds a person to catch it. The state
should not be reachable.

## Decision

**A design whose back reaches into the reserved footer cannot be stored.**

`SavedDesignsService` refuses it, at `parseDocument` — the choke point every
persisted document already passes through — plus the template-copy path, which
bypasses `parseDocument` when a catalog template is copied verbatim.

The guardrail is at the _save_, not at checkout, for two reasons.

1. **It closes every downstream route at once.** Orders are created from three
   independent places, and only one of them is `BatchOrdersService.create()`:
   `auto-send.service.ts` and `returns.service.ts` both write `batchOrder.create`
   straight through Prisma. Guarding the checkout paths would have left both
   unguarded. A design that cannot enter a bad state cannot be ordered in one by
   any route, including ones added later.
2. **It fails where the customer can act.** The design is open in front of them,
   rather than the refusal landing on a payment screen after they have chosen a
   hundred recipients.

**Only placed elements block. A background does not.** A background always
covers the strip and simply stops at the line, which is 0166's designed
behaviour, not a fault. Blocking on it would block very nearly every back design
anyone has made. The composer now says these two different things differently: a
blocking message for elements, a plain note for a background.

**Judged at `DEFAULT_CARD_SIZE` (A6), deliberately.** The reserved 30 mm converts
to _more_ design units on the smaller card — 128.5 on A6 against 90.6 on A5 — so
the band starts at y=505.5 on A6 and only y=543.4 on A5. A6 is the stricter of
the two, so a design that clears it clears every size we print, and an admin
changing the house print size can never retroactively invalidate designs that
were already saved and sent. It is also the size in use, so today it is exactly
accurate.

## Consequences

Designs saved **before** this guard can still be unprintable, and are still
sitting in customers' libraries. So every interactive path re-checks before
taking money. There are **three**, and a first pass covered only two: `quickSend`
and `bulkSend` each hold a single design and check it where they load it, while
`create()` — the Checkout page, turning approved occasions into an order — holds
one design _per occasion_ and checks them together, before the occasions are
consumed so a refusal cannot strand them in `queued`. Its message names the
offending design, because a Checkout can span several. The composer also blocks
the pay button with a link to the design. A customer who hits it moves the item and
saves; the save-time guard then keeps it good.

**Unattended paths deliberately do not refuse.** Auto-send and returns reprints
keep going. Nobody is watching them, and a card that silently never posts is a
worse outcome for the recipient than one whose reserved strip was clipped —
which the print engine handles safely anyway. This is the one residual case, and
it shrinks to nothing as legacy designs are edited.

**This blocks placed elements, not wrapped text.** `backArtworkInReservedFooter`
deliberately under-reports a text block that starts above the line and wraps into
it, because a text element's real height depends on wrapping and font loading,
which only a renderer knows. That under-reporting is what makes it free of false
positives, and the absence of false positives is what earns it the right to block
rather than warn — a check that wrongly refuses a good design costs a customer
their send, which is worse than the thing it prevents. The editor measures
rendered nodes and does catch the wrapped case; making the editor _prevent_
placement outright is the remaining piece and is not done here.

Verified by removing each layer and watching the tests fail: dropping the
save-time guard fails the two refusal cases in `saved-designs.e2e-spec.ts`;
dropping the order-path net fails the three legacy-design cases in
`batch-orders.e2e-spec.ts`, one per interactive path. The order-path fixtures are written straight to the
database on purpose — the API can no longer produce that state, which is
precisely why they model a legacy design rather than a new one.
