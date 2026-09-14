# A card must print what was bought

Plan for the defect found on Hull East Kip McGrath's orders: cards rendering
each other's messages, and one card carrying two messages overlapping.

## What is actually wrong

`OrderRecipient` — the row that **is** one card — stores where the card goes and
what it cost, and nothing about what it says:

| frozen on the order line                       | read live at print time                          |
| ---------------------------------------------- | ------------------------------------------------ |
| `shippingAddressLine1/2/City/Postcode/Country` | `savedDesign.document` — the artwork and message |
| `dispatchOption`, `postageClass`               | `recipient.firstName` / `lastName`               |
| `priceMinor`, `postageMinor`                   | `recipient.customFields`                         |
|                                                | `occasion.type` / `title` / `occasionDate`       |

The destination and the price were understood to belong to the order. The
content was left as a pointer. `SavedDesignsService.update()`
(`saved-designs.service.ts:93`) overwrites `document` with no check for whether
any order references it, and `fulfillment.service.ts:921` hands whatever it says
now to the print run.

So an account that reuses one design per send — which is what a reusable design
library invites — silently rewrites every earlier order that used it.

**Reproduced**, not inferred, in `order-artwork-is-immutable.e2e-spec.ts`:

| action after a paid order   | expected      | actual                            |
| --------------------------- | ------------- | --------------------------------- |
| edit the design's message   | `"To Elise…"` | `"To Florence…"`                  |
| duplicate the text box (⌘D) | one message   | `"To Cole…"` **and** `"To Alex…"` |

Those are the two screenshots exactly. The overlap is the editor's own
**Duplicate** (`design-editor-client.tsx:503`), which offsets a copy "so both are
visible".

ADR 0158 reasoned about the neighbouring half and got it right for deletion:
a design an order references can't be hard-deleted, because that would "break
that immutable history". The history was never immutable — only undeletable.

## Decisions

### D1 — Snapshot the document onto `OrderRecipient`, when the row is created

Not a new policy: the order line already freezes the address, the postage class
and the price at exactly that moment. This finishes the sentence the schema
started.

**At row creation rather than at payment**, on the evidence:

- There are three creation sites (`batch-orders.service.ts:1106`,
  `returns.service.ts:565`, `auto-send.service.ts:213`) and they are the only
  places a card comes into existence. A rule attached to them cannot be missed.
- "Freeze when it leaves draft" is not a one-way door. An expired or cancelled
  Stripe checkout puts the order **back** to `draft`
  (`webhooks.service.ts:494` and `:539`), and payment itself arrives through
  four paths — the card webhook, a full wallet debit, a partial wallet debit,
  and auto-send. Four places to remember, one of which re-opens.
- A draft is the cart. Showing the customer a preview that can change after they
  look at it is the same defect one step earlier.

The cost is that a draft left in the cart keeps the artwork it was added with.
D4 turns that from a silent surprise into a button.

### D2 — Every render path reads the snapshot

Enumerated, so none is left behind:

| path                                     | today                             |
| ---------------------------------------- | --------------------------------- |
| ops print run (JSON + PDF)               | `fulfillment.service.ts:921`      |
| fulfilment queue card preview            | `DETAIL_SELECT` → same document   |
| artwork download membership check        | `print-run-artwork.service.ts:57` |
| message-page video seeding at settlement | `messages.service.ts:190`         |

The third is security-relevant, not cosmetic: it decides whether an operator's
click may fetch a URL server-side, and it must ask the card, not the design. A
design edited since the order would otherwise refuse a URL the card really
carries — or accept one it no longer does.

### D3 — A returned card reprints the card that was sent

`returns.service.ts:565` copies `savedDesignId` from the original line, so a
card recovered weeks later reprints whatever the design says _now_. Recovering a
returned card is precisely the moment you want the same card again. It copies
the snapshot instead.

### D4 — Ops keeps a way to correct a card, explicitly

This matters more than it looks. The way the team rescued these seven orders was
by editing the design — the very thing this change stops reaching a paid order.
Fixing the bug without replacing that tool would take away the remedy.

So: a super-admin action that re-syncs one card's artwork from its design,
audited, with the card's own before/after. The same action serves a draft whose
design has moved on. Editing a design stops having invisible consequences; a
deliberate, logged action gains them.

### D5 — Backfill existing unfulfilled orders, and say plainly what that does

Every existing `OrderRecipient` gets its design's current document copied in.
This is not a repair — there is no record of what a design used to say
(`SavedDesign` has no version history, and the service is deliberately not
audit-logged, `saved-designs.service.ts:17`). It stops the drift; it does not
undo it. Anything already wrong stays wrong until someone fixes it, and after
the backfill that fix is D4's action rather than a design edit.

### D6 — Name, custom fields and occasion are the same class, and are not in this change

They are read live at print time too, so a renamed contact changes a paid card's
`{firstName}`. Deferred deliberately, with the tension named rather than hidden:
the shipping address is _already_ frozen, so today a corrected contact reaches
the card's text but not its envelope. Whichever way that is resolved, it should
be resolved as one decision about a recipient rather than bolted onto this one.

**The check that would falsify the deferral** (per ADR 0238): a card whose
recipient was renamed or whose custom fields changed between order and print.
If that turns up in support, it is the same defect and is worth the same work.

## Data model

```prisma
model OrderRecipient {
  /// The design document as it stood when this card was bought — the card's
  /// own copy, never re-read from SavedDesign. `savedDesignId` stays, for
  /// provenance ("which design was this?") and for D4's re-sync.
  documentSnapshot Json @map("document_snapshot")
}
```

Sized from the real thing: a typical catalog document is **~520 bytes** (artwork
is a URL, not inline bytes), so a 2,000-card bulk order adds about 1 MB. Not a
constraint.

## Phasing

Each phase is independently mergeable and leaves the platform working.

**Phase 1 — the card carries its own artwork.** The column, written at all three
creation sites, plus a migration that backfills every existing row. Nothing
reads it yet, so nothing can break. The failing e2e stays failing.

**Phase 2 — everything renders from it.** The four paths in D2, plus D3's
reprint. The bug is dead at the end of this phase and the e2e goes green.

**Phase 3 — the ops re-sync.** D4: a super-admin action per card, audited,
behind the same guard as every other platform control.

**Phase 4 — guards.** A scan in the repo's existing style: no render path may
reach `savedDesign.document` for a card. Plus the reproduction kept as a
regression test, and a property test that a snapshot is printable.

## Tests and guards

- **The reproduction**, already written: edit a design after payment, and the
  card is unchanged. Kept as the regression test.
- **A second message added later doesn't reach a paid card** — the ⌘D case.
- **A returned card reprints byte-identically** after its design has moved on.
- **A scan** that `savedDesign.document` is not selected on any path that
  renders or validates a card, in the shape of `no-bare-fetch`: the list of
  files allowed to read it is short and each entry says why.
- **Every snapshot is printable** — the reserved-footer rule is enforced on the
  way in today; a snapshot must not become a way around it.

## Deferred

- **Recipient name, custom fields and occasion** (D6) — with the falsifying
  check written down.
- **Repairing the already-corrupted orders** — impossible from our data; ops has
  corrected the live ones by hand.
- **Design version history.** It would have made this recoverable rather than
  merely stoppable. Worth revisiting on its own merits, not as part of this.
