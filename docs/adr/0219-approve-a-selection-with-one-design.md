# 0219 — Approve a selection with one design

## Status

Accepted — implemented. The product decision ADR 0218 raised and did not take.

## Context

ADR 0218 fixed the calendar's list view showing look-alike checkboxes beside
occasions that could not be ticked, and named the limit behind the report:

> It does not add bulk approve. Approving is per-occasion because it is where
> the design is chosen, and `/approvals` offers bulk _skip_ but not bulk
> _approve_. So "send to multiple people" is still: approve each card, then
> order them together in one click.

For a tuition centre with thirty birthdays in a month, that is thirty rounds of
choose-a-design-and-click-Approve before the one-click order at the end. The
bulk bar could clear a queue but never fill one.

**This is not `/send`.** `POST /batch-orders/bulk-send` already posts one saved
design to many existing contacts (ADR 0027), and it is the right tool for "send
this card to these thirty people **now**". It creates one-off occasions
dispatched `asap`; it does not touch the dated occasions sitting in the
approvals queue. Using it for a month of birthdays would post thirty cards today
and leave thirty birthdays still unapproved behind them — two cards each, one of
them early. The approvals queue exists precisely because those cards go out on
each person's own day.

So the gap is real and specific: **one design, many occasions, each keeping its
own date.**

## Decision

`POST /occasions/approve-bulk` — `{ occasionIds, savedDesignId, dispatchOption?,
postageClass? }` → `{ approvedIds, failed }`.

The same fields as the single approve plus the ids, deliberately: a bulk approve
is the single approve applied to many, not a second way of approving with its
own rules.

### One implementation, not two

`approve` now checks the design belongs to the account and delegates to a
private `approveWithCheckedDesign`. `approveMany` checks the design **once** for
the whole selection and calls the same method per occasion. Both paths therefore
run the same transition, the same auto-send gates and the same audit entry.

A bulk action that reimplements its single counterpart is how the two closing
paths in ADR 0196 came to disagree about `resolvedAt` — one of them was wrong
for months, on the documented happy path.

### It always answers per occasion

The response carries `failed` alongside `approvedIds`, and the endpoint returns
success even when some could not be approved. That is not leniency; it is the
rule ADR 0186 set for the CRM ingest and ADR 0214 set for CSV import. Part of a
selection failing is _ordinary_:

- auto-send needs a complete postal address, and one contact in thirty will not
  have one;
- someone else may have approved or skipped an occasion while the screen sat
  open;
- an id may no longer exist at all.

Throwing on the first of those would abandon twenty-nine good approvals for one
missing address — and the customer would have no idea which of the thirty was
the problem.

Each failure carries the **recipient's name**, not just an id. "3 could not be
approved" tells a reader something is wrong and gives them no way to act; "Ada
Lovelace — auto-send needs a recipient with a postal address" tells them what to
fix. The rows stay in the queue, still ticked, beside the reason.

### Bounds

- `BULK_APPROVE_MAX = 100`, matched to the approvals page's own `perPage=100`.
  "Select all N" can never tick more than a page, so this is the real ceiling
  rather than a number invented for the DTO.
- `APPROVE_CONCURRENCY = 6` — each approve is a write plus an audit row, and
  auto-send adds two reads. The same bound ADR 0210 settled on, for the same
  reason.
- The ids are read back **account-scoped** before anything is written, so an id
  from another account is a reported failure rather than a write, and duplicates
  in one request approve once rather than the second copy failing as "no longer
  pending" because the first just approved it.

## Consequences

- A month of birthdays is one design, one click, and each card still posts on
  its own day.
- Auto-send works in bulk where the plan allows it, which is where doing it one
  at a time hurt most.
- The failure list is the screen's own to-do: what is left in the queue and why.

Nine e2e cases cover the happy path, a missing address, an occasion already
skipped, another account's id, another account's design, a repeated id, and both
size bounds. Four mutations of the service were each caught: dropping the dedupe,
dropping the account scope on the read-back, letting one bad row abandon the
batch, and skipping the design check. Six web cases cover the request shape, the
disabled state, which rows leave the queue, the named failures and the auto-send
controls; five mutations of the client were each caught.

## What was not done

**Per-occasion designs in a bulk approve.** The bulk bar applies one design to
everything ticked. Respecting a design chosen individually on some rows and the
bulk one on others is two mental models in one action, and the row-level Approve
button already covers "this one is different".

**A confirmation step.** Approving is reversible — `POST /occasions/:id/unapprove`
puts an occasion back in the queue — so the one-way-door reasoning that made bulk
_skip_ a deliberate act (ADR 0174) does not apply here. Auto-send is the part
that spends money, and it stays an explicit opt-in with the plan gate behind it.
