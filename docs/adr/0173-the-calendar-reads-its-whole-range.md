# 0173 — The calendar reads its whole range, and says so when it can't

## Status

Accepted — implemented.

## Context

A customer imported two thousand contacts and reported that the calendar's month
view showed nothing after 17 September — while the week view covering that same
date showed the 18th, 19th and 20th perfectly well.

Both views drew the same data. The month view was reading one page of it.

`GET /occasions` is paginated, and `parsePerPage` caps `perPage` at 100. The
calendar asked for exactly 100 and rendered `items` — one page, no loop, on both
the server render and every client navigation. Asking for more did not help: 500
was clamped back to 100 without comment.

Counting the pills in the reported screenshot, including the "+N more" tails,
gives **exactly 100**. The cut lands _mid-day_ on the 17th — that day showed 9 in
the month view and 12 in the week view — which is the signature of a record cap
rather than a date filter.

Week view escaped it by being small. For an account with two thousand contacts,
roughly 5.5 birthdays fall on any given day:

| View                     | Days | Occasions | Shown   |
| ------------------------ | ---- | --------- | ------- |
| Week                     | 7    | ~38       | 100%    |
| Month grid               | 42   | ~230      | 43%     |
| The server's first fetch | ~98  | ~537      | **19%** |

That last row is the worst of it. The page server-renders the _union_ of the
month grid and the list view's three-month window, so whichever view the client
settles on already has its data — a deliberate choice to avoid a flash, which
also made the truncation bite hardest on first paint.

The payload carried `total` the whole time. The page had everything it needed to
say "showing 100 of 537" and said nothing.

## Decision

**`GET /occasions/calendar` returns the whole range.** Not a page of it.

A date range is a bounded question and deserves a whole answer. The window a
calendar draws is one the user picked, and it is at most a few months.

**It is a separate endpoint, not a flag on `/occasions`,** because the two reads
want opposite things. `/occasions` nests each contact's postal address so
checkout can pre-fill a shipping line rather than asking for it twice (ADR 0119).
The calendar renders no address anywhere — it reads `firstName` and `lastName`
and nothing else from the recipient. Trimming the shared endpoint would have
silently broken checkout's pre-fill; keeping the fat shape on the calendar ships
428 bytes a row to draw a name.

Measured on real rows: **790 bytes against 362**. A month of that account is
81 KB rather than 177 KB.

**`CALENDAR_MAX_OCCASIONS = 1000` is a backstop, not a page size.** It exists so
a hand-crafted decade-wide range cannot ask the database for everything. It sits
at roughly double what the largest ordinary account can produce: the widest
window the calendar asks for is a little over three months, and the largest
self-serve plan caps contacts at 2,000.

**When it does bite, the response says so.** `truncated` is a fact from the
server, not something the client infers by comparing two numbers and hoping it
got the comparison right, and the calendar renders a notice naming the way out.
Silence was the actual defect here — a month that stops partway through a day
with no explanation reads as data loss, and the customer reasonably reported it
as one.

The count behind `total` is only run when the cap was actually reached. On every
ordinary range the number of rows just fetched _is_ the total, and a second query
for a number already in hand is a query wasted.

## Consequences

`/occasions` is untouched: still paginated at 100, still carrying addresses, so
checkout, approvals and the contact detail page are unaffected. The two shapes
are now explicitly different types — `CalendarOccasion` alongside `Occasion` —
rather than one shape doing two jobs adequately.

A full `Occasion` satisfies `CalendarOccasion` structurally, so the detail modal
still PATCHes `/occasions/:id` and drops the full row it gets back straight into
the calendar's state.

The union fetch stays. It costs more than fetching only the visible view, but it
is a deliberate trade against a flash on first paint, and with lean rows the
union is now cheaper than the single month used to be.

**The month grid still does not render everything, and now that is only a
layout decision.** A cell shows three pills and a "+N more"; the week view shows
twelve. Those caps are about the size of a box, not about what the page knows —
so "+N more" is a button that opens the whole day. It fetches nothing: every
occasion in the visible range is already in the client, which is what made the
old inert label so odd. The label counts shared events as well as occasions,
because the pop-up lists both.

That gap was invisible behind this bug, because the days it affected were the
days that had already vanished. Fixing the read is what made it worth fixing.

Verified by restoring the old behaviour — the 100 cap and the fat select — and
watching four of the seven cases fail: the range, the addresses, the truncation
flag and the type filter.
