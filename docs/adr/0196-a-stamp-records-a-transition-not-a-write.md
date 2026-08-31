# 0196 — A stamp records a transition, not a write

## Status

Accepted — implemented. From an external code review (finding 31 of 37).

## Context

`updateTicket` is the ops path for changing a support ticket's status. Its
docstring says:

> Resolving/closing stamps the corresponding timestamp; reopening (back to
> open/awaiting_customer) clears the resolved/closed stamps.

The code beneath it:

```ts
data.resolvedAt = status === "resolved" ? new Date() : null;
data.closedAt = status === "closed" ? new Date() : null;
```

Read quickly this looks like the sentence above it. It is not. Each line sets
_its own_ stamp on a match and **nulls it on everything else**, so every status
change clears the other stamp — including the documented happy path,
`open → resolved → closed`. The move to `closed` nulled `resolvedAt`.

Every ticket that ended the normal way therefore lost its time-to-resolution —
which is to say, the only tickets whose resolution time is worth measuring. The
customer-side `close()` a few hundred lines above does not do this: it writes
`status` and `closedAt` and leaves `resolvedAt` alone. Two closing paths,
different answers, and the ops one was wrong.

A second, quieter fault sat in the same two lines: the stamps were written on
every status write, not on a change of status. An operator re-saving a ticket
that was already `resolved` — to raise its priority, say — silently reset when
it was resolved to now.

## Decision

Status stamps move only on a transition _into_ a status, and what each
transition writes is stated once, in a named function rather than inline
ternaries:

| Move into                    | `resolvedAt`   | `closedAt`                       |
| ---------------------------- | -------------- | -------------------------------- |
| `resolved`                   | set to now     | cleared — it is no longer closed |
| `closed`                     | **left alone** | set to now                       |
| `open` / `awaiting_customer` | cleared        | cleared                          |

Each stamp records that the ticket reached that state and has not gone back
behind it. So closing keeps the resolution time; reopening clears both, because
the ticket is live again and neither describes anything that still holds; and a
ticket closed without ever being resolved simply keeps `resolvedAt` null, which
is the honest answer rather than a gap to be filled.

`updateTicket` already loaded the ticket via `requireTicket` and threw the row
away. It now keeps it, and compares.

## Consequences

- Time-to-resolution survives the normal lifecycle and becomes measurable.
- Re-saving a status a ticket already holds no longer moves its stamps.
- The ops and customer close paths now agree.

Four mutations were run, each caught by the test written for it: nulling
`resolvedAt` on close again, dropping the transition check, not clearing the
stamps on reopen, and leaving a stale `closedAt` behind when a closed ticket
goes back to resolved.

## The lost data is not lost

The review called the erased `resolvedAt` "permanently unrecoverable". It is
recoverable for tickets resolved through the ops path, because that path writes
an audit entry naming the status it moved to, and audit entries are timestamped
and never pruned.

The recovery is not, however, "find a `resolved` entry and copy its timestamp".
Some tickets have one in their history and should still have a null
`resolvedAt` today, because something later legitimately cleared it — the
customer replied, or ops moved the ticket back to `open`/`awaiting_customer`.
Under the rule above, a stamp records that the ticket reached a state _and has
not gone back behind it_, so a ticket resolved, reopened, then closed without
being resolved again has no resolution time to restore, and writing one would
invent data. A ticket resolved, reopened, and resolved again should carry the
_later_ resolution, because that is what the fixed code writes.

So the recovery replays the events that move the stamp and asks what the last
one did, restoring a timestamp only when that last event is a resolution.

The query lives in `docs/ops/p2-18-support-resolved-at-recovery.sql`, in
numbered steps with two read-only previews before the single write. It was
checked by replaying eight ticket lifecycles against a real Postgres and
comparing its output to what the fixed code would have left behind; five
mutations of it were each caught by that fixture.

An earlier version of this ADR carried a one-shot `UPDATE` that took the
_first_ `resolved` audit entry for any ticket with a null `resolvedAt` and a
non-null `closedAt`. Tested against those eight lifecycles it is wrong on
three: it resurrects a stamp on a ticket the customer reopened by replying, it
resurrects one on a ticket ops moved back to `awaiting_customer`, and where a
ticket was resolved twice it restores the first resolution rather than the
second — which contradicts the table above, in the same document. It was
written by reasoning about the schema rather than by running it. The ops file
replaces it.

This is offered, not applied: it is a data change to production, and it is the
account owner's call.
