# Nothing checks what the card actually says

Two cards, two complaints, one shape: we printed something nobody meant to send,
and no part of the system objected.

- **Elise Bisby's card** carries two messages stacked on the inside-right face —
  hers and Florence's, overlapping.
- **Cole Fortes's card** (the original report) carried a message addressed to
  "alex".

This plan is about the second half of that pair. The first half — a design edit
rewriting a card already paid for — was fixed in #429–#432 and is closed. This is
what those PRs did not cover.

## What is actually happening

The overlap is **two text elements in the stored design document**. Not a
rendering fault, and not something the software did on its own:

- `applyMergeTokens` (`packages/shared-types/src/merge.ts:243`) maps elements
  one-to-one. It can never add one.
- The only code anywhere that appends to a page's `elements` is five lines in
  `design-editor-client.tsx` — add text, add shape, add QR, duplicate, add image.
  All are explicit user actions.
- `SavedDesignsService.create` copies a template into a **new** row. It never
  merges into an existing document.

So a person wrote a message for Florence, later wrote one for Elise, and the
second went in _beside_ the first rather than replacing it. Then the design was
used for a batch, and every card in it got both.

The same authoring habit explains the Cole Fortes card without needing any bug at
all: a recipient's name typed literally into a design that is then sent to
somebody else.

## Why the previous work does not catch it

#429–#432 froze what a card says at the moment it is bought. That closes the
path where a _finished_ card changes underneath you. It cannot help when the
document was already wrong at purchase: we faithfully freeze, and faithfully
print, the mistake.

And the backfill copied each design's _current_ document, so a card damaged
before the migration keeps the damage. Elise's card is one of those.

## The actual gap

The pre-send check (`pre-send-check.tsx`) has exactly four buckets:

| bucket                                   | tone    |
| ---------------------------------------- | ------- |
| No postal address                        | blocker |
| Address needs checking                   | blocker |
| Personalisation gaps (unresolved tokens) | warning |
| Recently sent this design                | warning |

None of them asks the two questions these cards needed:

1. **Are two pieces of text sitting on top of each other?** A design with
   stacked message blocks is never intentional on a greetings card.
2. **Does this design name a person by hand, who is not the person receiving
   it?** We know every recipient in the batch. A design that says "Florence"
   going to Elise is answerable, cheaply, before payment.

There is a third gap behind both: **when a card looks wrong, ops cannot see what
it says.** The order cockpit renders the card; it has no way to show the text the
card actually carries. Diagnosing Elise's card meant reading a screenshot.

## Decisions

**D1 — Detect, don't auto-correct.** We never silently delete a customer's text
block. Overlapping text is suspicious, not provably wrong (a caption over a
banner is legitimate). The product's job is to make it impossible to _miss_, not
to decide.

**D2 — The literal-name check is scoped to the batch, and warns.** We compare the
design's text against the first names of the recipients being sent to, which is
the only comparison we can make without guessing at what is and is not a name. A
name that matches nobody in the batch is worth flagging; it is not worth
blocking, because "To Mum" and "Team Kip" are legitimate and so is a card for
someone whose name appears for an unrelated reason.

**D3 — Overlap is judged on rendered boxes, not authored ones.** Text height
depends on wrapping and on which font loaded. `backArtworkInReservedFooter`
already documents this trap and deliberately under-reports. We follow the same
rule: under-report rather than cry wolf, and say so.

**D4 — One pure definition.** The maths goes in `shared-types` beside the merge
and reserved-footer helpers, so the editor, the pre-send check and any future ops
panel cannot disagree about what "overlapping" means.

**D5 — Ops gets to read the card, not just look at it.** A super admin should be
able to see the text a card carries. This is the cheapest of the four changes and
would have turned this investigation into a ten-second answer.

## Phases

Each phase is its own PR, merged when green before the next starts.

### Phase 1 — Say what "wrong" means, in one pure place

- `overlappingTextElements(page)` — pairs of text elements whose rendered boxes
  intersect by more than a threshold fraction, in `shared-types`.
- `literalNamesIn(document, names)` — which of a given set of first names appear
  as literal text in a document, outside a merge token.
- Unit-tested against the two real cases: Elise/Florence stacked, and a card
  naming someone not in the batch. Pure; no behaviour change yet.

### Phase 2 — Stop it reaching print

- Two new findings on the pre-send check: **"Two pieces of text overlap"** and
  **"This design says <name>"**, both warnings, both naming the face so the
  sender can act.
- The API's preflight is the source of truth (the web surface renders what it is
  given), so the check runs where the order is actually placed, not only in the
  browser.

**Corrected while building this.** The plan said _buckets_. It should not have:
a `PreflightBucket` is per-recipient, and the codebase had already settled this
question for `backArtworkClipped`, whose comment says a bucket "would list every
recipient in the run for one problem that is the same on all of them". Both of
these are properties of the design, so they sit beside it as design-level
findings instead.

The name check also grew a second half while being built. A salutation line
("Dear alex,") names one person outright and needs no list to compare against,
so it catches a name belonging to nobody in the send at all — which is the Cole
Fortes card exactly, and which `literalNamesIn` alone could never have found.
`literalNamesIn` still runs, against this send's own recipients, because a
recipient's name appearing in the text is wrong for every _other_ card in the
batch. Two checks, two different mistakes.

### Phase 3 — Catch it at authoring time

- The editor warns the moment two text blocks overlap, beside the existing
  safe-area and reserved-footer warnings. This is the only surface where it costs
  the customer nothing to fix.

**How it measures, and why that differs from phase 2.** The canvas reads the
_rendered_ Konva nodes, exactly as the reserved-strip check already does, because
a text element's real height depends on wrapping and on which font has loaded.
The pre-send check has to estimate those boxes from the stored document, because
a server has nothing else. What the two share is the **rule** —
`overlapFraction` and `OVERLAP_MIN_FRACTION` — not the measurement. Sharing the
measurement is impossible; sharing the rule is what stops them quietly
disagreeing about what "overlapping" means, which is the failure ADR 0242 names
and would be a poor thing to reintroduce three phases into fixing it.

### Phase 4 — Ops can read the card

- Show the card's text content in the order cockpit, from its own
  `documentSnapshot` — what _this_ card says, not what the design says now.
- Paired with the existing **Refresh artwork** (#431), that gives an operator the
  full loop: see that it is wrong, see what it says, correct the design, re-copy
  it onto the card, all before print.

## What this does not fix

Cards already printed and posted. And cards already damaged but not yet printed
keep their damage until someone corrects the design and re-syncs them — the
snapshot froze the mistake. Phase 4 is what makes those findable.
