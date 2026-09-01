# 0218 — A box appears only where it can be ticked

## Status

Accepted — implemented. From super-admin feedback on the calendar's list view.

## Context

The report:

> On the list view, the squares next to names — are they meant to be able to
> multi-select so you can send to multiple people? At the moment the boxes are
> not selectable and you can only select individual names.

The multi-select is real and it works. The list view lets you tick approved
occasions, shows "N approved cards selected" in a sticky bar, and hands the ids
to `/batch-orders?occasions=…` so a scattered set is checked out in one go.

The problem is which rows got a box.

```tsx
const orderable = occasion.status === "approved";
const needsApproval = occasion.status === "pending_approval";
…
{orderable ? (
  <input type="checkbox" … />
) : needsApproval ? (
  <span aria-hidden title="Approve this occasion …"
        className="inline-block size-3 shrink-0 rounded-[3px] border border-warning/40 bg-warning-soft" />
) : null}
```

An occasion awaiting approval got an **inert span the same size and shape as
the checkbox beside it**. Its only explanation was a `title`, on an element
marked `aria-hidden`.

Three things make that worse than it sounds.

**It is the default state, not an edge case.** Recurring occasions are created
`scheduled` and promoted to `pending_approval` when they come within
`BIRTHDAY_LOOKAHEAD_DAYS` (21). Approving is what chooses a design, and it is
done one at a time on `/approvals`. So an account that has not worked its
approvals queue has a calendar of `pending_approval` rows — every one of them
wearing a box that does nothing. That is exactly the screenshot that came with
the report.

**Nothing else told them apart.** The pill is coloured by occasion _type_, not
status, so an approved birthday and an unapproved one are the same amber. The
legend says "Upcoming (coloured by type)". The square was the only signal, and
it was a false one.

**The column was ragged for no visible reason.** Beyond 21 days an occasion is
still `scheduled`, which rendered no square at all. So one screen showed real
checkboxes, look-alike squares and nothing, in three statuses a reader cannot
see, with the boundary being a lookahead constant.

The placeholder's stated purpose was alignment — "show a muted placeholder in
the checkbox column so the row lines up". There is no column: the pills are
`flex flex-wrap`, laid out inline and wrapping. It was buying nothing.

## Decision

**A box appears only where it can be ticked.** The placeholder is gone.

On its own that would leave a reader with nothing approved staring at a list
with no boxes and no more idea what to do than before. So the list gained a
summary of what is actually actionable in the window on screen:

- **`N cards are ready to order`**, with **`Select all N`** / **`Clear
selection`** — the bulk affordance the report was asking for, which
  previously required ticking each one.
- **`M still need approving`**, with **`Review & approve →`** to `/approvals` —
  what the `aria-hidden` `title` was trying and failing to say.
- When nothing is approved: _"No cards here are ready to order yet — approving
  one chooses its design."_ The absence of boxes is now explained rather than
  merely observed.

`Select all` is scoped to the occasions that can be ordered, not to everything
visible, so it can never build a selection checkout would reject.

## Consequences

- The screen no longer offers an affordance it does not have.
- Building an order from a full month is one click rather than N.
- A reader who cannot act is told why, and where to go.
- The list view had **no tests at all**; it now has nine, covering each status,
  the multi-select, select-all/clear, and the deep link the selection becomes.
  Four mutations were each caught: making every occasion tickable, letting
  select-all sweep in unapproved ones, making select-all unable to clear, and
  dropping the needs-approving count.

## What this does not do

**It does not add bulk approve.** Approving is per-occasion because it is where
the design is chosen, and `/approvals` offers bulk _skip_ but not bulk approve.
So "send to multiple people" is still: approve each card, then order them
together in one click.

That is the real limit behind the report, and it is a product decision rather
than a defect — one design applied to many contacts changes what an approval
means. Raised separately rather than decided here.
