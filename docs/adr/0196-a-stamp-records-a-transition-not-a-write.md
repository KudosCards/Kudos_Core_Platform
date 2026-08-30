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
an audit entry naming the status it moved to, and audit entries are timestamped:

```sql
UPDATE support_tickets t
SET resolved_at = a.created_at
FROM (
  SELECT DISTINCT ON (target_id) target_id, created_at
  FROM audit_log_entries
  WHERE target_type = 'SupportTicket'
    AND action = 'support_ticket_updated'
    AND metadata->>'status' = 'resolved'
  ORDER BY target_id, created_at ASC
) a
WHERE t.id = a.target_id
  AND t.resolved_at IS NULL
  AND t.closed_at IS NOT NULL;
```

`DISTINCT ON … ORDER BY created_at ASC` takes the _first_ time each ticket was
resolved, which is the resolution time worth keeping when a ticket was resolved,
reopened and resolved again. Run the `SELECT` on its own first to see what it
would touch.

This is offered, not applied: it is a data change to production, and it is the
account owner's call.
