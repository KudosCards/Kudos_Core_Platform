# Nothing stops the wrong name going out

Elise Bisby's card carried her message and Florence's, overlapping. We fixed
the seeing. We did not fix the stopping.

Three surfaces now report this — the editor, the pre-send check, the ops print
run — and **a customer can click past every one of them.** That is stated as a
decision in `batch-orders.service.ts`:

> Warnings, never blockers. `reservedFooterViolation` earns the right to refuse
> a send by being free of false positives; these estimate text boxes from the
> document and read names out of prose, so they cannot make the same claim. A
> check that sometimes stops a perfectly good send is worse than one that
> sometimes stays quiet.

That reasoning is right, and it is not the whole answer. This plan closes the
gap without breaking it.

## What the recon actually found

**There is no "duplicate a saved design" feature.** Every path that creates a
saved design makes a _fresh_ one: `createFromTemplate` from a catalog card, or
`uploadArtwork` from a file. Nothing copies an existing design. So the
hypothesis that this came from duplicating Florence's design is wrong.

The real mechanism is duller and harder to design around: **"My Designs" is a
library of reusable templates that an account edits between sends.** One design,
many sends, edited in place. Kip McGrath sent to Florence, came back for Elise,
and — via "Add text" or ⌘/Ctrl+D (`duplicateSelected`, offset 16×16) — wrote the
new message beside the old one instead of over it.

Reuse is the product. It is not going away, and it should not.

**The editor never mentions a hand-typed name.** `salutationNames` exists and is
used in exactly one place: `batch-orders.service.ts:795`, at checkout. The
moment somebody types `To Florence,` is the cheapest moment in the whole system
to say "use the First name field instead", and we say nothing until they have
built an entire send.

## What already cannot happen again

Worth separating from what follows, because it is the one thing closed
structurally rather than by a message:

- **A design edit reaching an already-paid card.** Every card carries its own
  `documentSnapshot` — required, no default, pinned by
  `card-artwork-single-source.spec.ts`. Editing a design cannot rewrite a card
  someone has bought.
- **Authored content in the back's reserved strip.** Refused at save time and
  again at send time, server-side.

## Decisions

**D1 — A confirmation gate, not a blocker.** A hard block has a real false
positive: nicknames. "To Lizzie," on a card to Elizabeth is correct, and a rule
that refuses it traps a customer with no way out. So the send is not refused —
it requires the sender to **say they know**, naming the person and how many
cards are wrong. That stops the hurried click-past, which is the actual failure,
without stopping anybody.

**D2 — The gate is server-enforced.** An acknowledgement that only exists in the
UI is decoration. The send DTO carries it and the server refuses without it,
exactly as `assertDesignPrintable` already does for the reserved strip.

**D3 — Gate the salutation, not the overlap.** `SALUTATION_LINE` matches a line
that is _only_ a salutation naming one person, and cannot match `{firstName}`
because a merge token does not start with a letter. It is precise.
`stackedText` is estimated from `GLYPH_WIDTH_FACTOR` and a guess at wrapping, so
it stays a warning — the editor now catches it at authoring time, which is the
better moment anyway.

**D4 — Unattended paths never refuse.** Auto-send and returns reprints run with
nobody watching. ADR 0171 already settles this for the reserved strip: a card
that silently never posts is a worse outcome than a card with a flaw. The same
holds here, and for the same reason.

**D5 — Say it where it is typed.** Every guard below the editor is a guard after
the fact. The editor is the only surface where the fix costs one click and
nothing has been bought.

**D6 — Not in scope: an ops repair path.** Ops can see this and cannot fix it —
there is no admin route that writes a saved design, and `MembershipGuard` scopes
every one to the signed-in user's own account. That is a real gap, but Kudos
have said they are stepping in manually on the current orders, so it is recorded
here rather than built.

## Phases

Each phase is its own PR, merged when green before the next starts. Phases 1–3
have landed; Phase 4 is outstanding.

### Phase 1 — The editor says it when it is typed

- The design editor warns when the active face carries a hand-typed salutation,
  and points at the **Insert merge field** control that fixes it.
- Uses the same `salutationNames` the send check uses, so the two cannot
  disagree about what counts as naming somebody.

The editor has no recipient list, so it cannot say _how many_ cards are wrong —
only that a name is written by hand where a merge field belongs. That is the
right message at that moment, and it is the whole fix if they take it.

**Falsifying check**: `To {firstName},` must produce no warning at all. If the
guard fires on the correct way to write a card, it will be ignored within a day.

### Phase 2 — One click to fix an overlap

- The editor's stacked-text banner names both blocks by their first line and
  offers to delete either.

Today it says two blocks overlap and leaves the customer to find them on a
canvas where one is underneath the other. A warning whose remedy is "go and hunt
for it" is a warning people close.

### Phase 3 — The send makes them say they know

- When a **salutation** is wrong for at least one card, the send is refused
  unless the request carries an explicit acknowledgement of that person
  (`acknowledgeNames`).
- The pre-send UI presents it as a checkbox naming the person and the count —
  "This says Florence, and 1 of 1 cards is going to somebody else."
- Interactive sends only (D4).

**Falsifying check**: the acknowledgement must be keyed to the _name_, not a
bare boolean. A send acknowledged for "Florence" that is then edited to say
"Alex" must ask again, or the gate is a one-time dismissal.

**Both interactive paths, not just the bulk one.** The single-card send is the
flow a school uses one pupil at a time, reusing one saved design — the likeliest
route to the card that started this — so it carries the same gate, computed in
the browser against the recipient being typed and enforced on `quick-send` the
same way. Checking happens before any contact or occasion is created, so a
refusal leaves nothing behind for the second attempt to trip over.

**Only the salutation half blocks** (D3). `literalNamesIn` still reports, and
still never refuses: a card to Joy that says "wishing you joy" is not a mistake.
The distinction is carried on the finding itself as `mustAcknowledge`, decided
server-side, so the UI cannot drift from the rule it is describing.

### Phase 4 — Ops can see the whole card

- **Preview card** in the fulfilment queue shows every face with the text
  readout, instead of the front alone.
- It currently says "printed exactly as shown" while showing one of four faces —
  a promise it cannot keep, and the reason an operator can look straight at this
  bug and see a perfect card.

## What this does not fix

A customer who reads the acknowledgement, understands it, and sends anyway. That
is their call to make, and the platform should let them make it — it just should
not let them make it by accident.
