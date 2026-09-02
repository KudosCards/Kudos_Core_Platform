-- P2-18 recovery — restore the `resolved_at` values the ops ticket path erased
-- (ADR 0196, review finding 31).
--
-- ===========================================================================
-- NOTHING TO RECOVER — checked against production, 1 September 2026.
--
--   Step 0                      0 closed tickets, 0 missing a resolution
--   support_tickets by status   one ticket, `resolved`, stamp intact
--
-- The erasure only ever happened on a move into `closed`, and no ticket has
-- reached that state. The one ticket that has been resolved still carries its
-- `resolved_at`, so there is no gap to fill and Step 3 would write nothing.
--
-- Do not run Step 3 expecting rows. Steps 0-2 stay read-only and safe.
--
-- The fix (#388) has been on `main` since 30 August, so a ticket resolved and
-- then closed from here on keeps its resolution time. This file is kept as the
-- record of what the defect would have cost and how it would have been undone,
-- not because it is still owed. If it is ever needed — an old row surfacing
-- from a restore, say — the steps below are tested and idempotent.
-- ===========================================================================
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NEEDED
--
-- Until #388, the ops path wrote its status stamps as:
--
--     data.resolvedAt = status === "resolved" ? new Date() : null;
--     data.closedAt   = status === "closed"   ? new Date() : null;
--
-- Each line sets its own stamp on a match and NULLS IT ON EVERYTHING ELSE, so
-- moving a ticket to `closed` erased `resolved_at`. That is the documented
-- happy path — open, resolved, closed — so every ticket that ended the normal
-- way lost its time-to-resolution, which is exactly the set whose resolution
-- time is worth measuring.
--
-- The value is recoverable because the ops path writes a timestamped audit
-- entry naming the status it moved to, and audit entries are never pruned.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT SIMPLY "FIND A RESOLVED ENTRY AND COPY ITS TIMESTAMP"
--
-- Some tickets have a `resolved` entry in their history and SHOULD still have a
-- null `resolved_at` today, because something later legitimately cleared it:
--
--   * the customer replied, which reopens the ticket (`support_ticket_customer_reply`)
--   * ops moved it back to `open` or `awaiting_customer`
--
-- Under the rule ADR 0196 settled on, a stamp records that the ticket reached
-- that state AND HAS NOT GONE BACK BEHIND IT. So a ticket that was resolved,
-- reopened, and then closed without being resolved again has no resolution time
-- to restore, and writing one would invent data.
--
-- Equally, a ticket resolved, reopened, and resolved AGAIN should carry the
-- LATER resolution, because that is what the fixed code writes.
--
-- So the query below does not ask "was this ever resolved". It replays the
-- events that move the stamp and asks what the LAST one did. Only when the last
-- such event is a resolution does it restore that event's timestamp.
--
-- Events that move `resolved_at`, and how they are recorded:
--
--   support_ticket_updated, metadata.status = 'resolved'            -> set
--   support_ticket_updated, metadata.status = 'open'                -> clear
--   support_ticket_updated, metadata.status = 'awaiting_customer'   -> clear
--   support_ticket_customer_reply                                   -> clear
--
-- Deliberately NOT in that list, because neither touches `resolved_at`:
--   support_ticket_updated, metadata.status = 'closed'
--   support_ticket_closed_by_customer
--
-- ---------------------------------------------------------------------------
-- HOW THIS WAS CHECKED
--
-- Eight ticket lifecycles were replayed against a real Postgres 16 and the
-- query's output compared against what the FIXED code would have left behind:
-- resolved-then-closed; resolved-then-customer-reply-then-closed; resolved,
-- reopened, resolved again, closed; closed without ever being resolved;
-- resolved then closed by the customer (never erased); resolved, closed, then
-- reopened and still live; a priority-only edit in the middle; and resolved
-- then moved to awaiting_customer then closed. All eight match.
--
-- Five mutations of the query were each caught by that fixture: dropping the
-- customer-reply reopen, taking the first resolution instead of the last,
-- ignoring ops reopens, dropping the target_type scoping, and dropping the
-- only-fill-gaps guard.
--
-- The query in ADR 0196 predates this check and gets three of those eight
-- lifecycles wrong. Use this file, not that one. The ADR has been corrected.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT
--
-- Paste one step at a time into the Supabase SQL editor and read the result
-- before moving on. Each step is a single self-contained statement: the editor
-- runs each request in its own session, so there is no transaction spanning
-- steps and nothing to COMMIT.
--
-- Step 3 is idempotent — it only fills nulls, so running it twice updates
-- nothing the second time. There is no need to be brave about it.
-- ===========================================================================


-- ===========================================================================
-- STEP 0 — How much was lost?
--
-- Expect: `missing_resolution` > 0. If it is 0, there is nothing to recover
-- and you can stop here.
--
-- Counted over every ticket with no `resolved_at`, not just closed ones. The
-- defect erased the stamp on the way to `closed`, so closed tickets are where
-- most of it is — but Step 3's WHERE is `t.resolved_at IS NULL` with no
-- mention of `closed_at`, so it also restores a ticket that was resolved and
-- never closed. Gating on the narrower population meant an operator could read
-- 0 here, stop, and leave recoverable rows behind. A gate must count what the
-- write will touch.
-- ===========================================================================

SELECT
  count(*)                                                        AS tickets,
  count(*) FILTER (WHERE resolved_at IS NULL)                     AS missing_resolution,
  count(*) FILTER (WHERE resolved_at IS NOT NULL)                 AS still_have_it,
  -- Where the missing ones sit, so the number above is readable.
  count(*) FILTER (WHERE resolved_at IS NULL AND closed_at IS NOT NULL) AS missing_and_closed,
  count(*) FILTER (WHERE resolved_at IS NULL AND closed_at IS NULL)     AS missing_still_open
FROM support_tickets;


-- ===========================================================================
-- STEP 1 — Exactly what Step 3 would write, itemised, before it writes it.
--
-- One row per ticket that will change. `hours_to_resolution` is the figure
-- being restored — sanity-check that the numbers look like real support work
-- rather than something absurd.
-- ===========================================================================

WITH stamp_event AS (
  SELECT
    target_id  AS ticket_id,
    created_at,
    id         AS entry_id,
    (action = 'support_ticket_updated' AND metadata->>'status' = 'resolved') AS is_resolution
  FROM audit_log_entries
  WHERE target_type = 'SupportTicket'
    AND (
      (action = 'support_ticket_updated'
         AND metadata->>'status' IN ('resolved', 'open', 'awaiting_customer'))
      OR action = 'support_ticket_customer_reply'
    )
),
last_event AS (
  SELECT DISTINCT ON (ticket_id) ticket_id, created_at, is_resolution
  FROM stamp_event
  ORDER BY ticket_id, created_at DESC, entry_id DESC
)
SELECT
  t.ticket_number,
  t.status,
  t.created_at                                                    AS opened_at,
  e.created_at                                                    AS resolved_at_to_restore,
  t.closed_at,
  round(EXTRACT(epoch FROM (e.created_at - t.created_at)) / 3600.0, 1) AS hours_to_resolution
FROM support_tickets t
JOIN last_event e ON e.ticket_id = t.id
WHERE e.is_resolution
  AND t.resolved_at IS NULL
ORDER BY t.ticket_number;


-- ===========================================================================
-- STEP 2 — What is NOT being recovered, and why.
--
-- Every ticket with a null `resolved_at` that Step 3 will leave alone, with the
-- reason. Read this before Step 3: it is the check that nothing is being
-- skipped by accident. Each ticket appears once.
--
--   reopened after resolution, never resolved again
--       Correct to leave null. The stamp records that the ticket reached
--       `resolved` and has not gone back behind it; this one went back.
--
--   never resolved through the ops path
--       Nothing was recorded to recover from. Either it was closed without
--       being resolved, or it is still open.
-- ===========================================================================

WITH stamp_event AS (
  SELECT
    target_id  AS ticket_id,
    created_at,
    id         AS entry_id,
    (action = 'support_ticket_updated' AND metadata->>'status' = 'resolved') AS is_resolution
  FROM audit_log_entries
  WHERE target_type = 'SupportTicket'
    AND (
      (action = 'support_ticket_updated'
         AND metadata->>'status' IN ('resolved', 'open', 'awaiting_customer'))
      OR action = 'support_ticket_customer_reply'
    )
),
last_event AS (
  SELECT DISTINCT ON (ticket_id) ticket_id, created_at, is_resolution
  FROM stamp_event
  ORDER BY ticket_id, created_at DESC, entry_id DESC
)
SELECT
  CASE
    WHEN e.ticket_id IS NULL THEN 'never resolved through the ops path'
    WHEN e.is_resolution     THEN 'RECOVERABLE — Step 3 will fill this one'
    ELSE 'reopened after resolution, never resolved again'
  END        AS outcome,
  count(*)   AS tickets
FROM support_tickets t
LEFT JOIN last_event e ON e.ticket_id = t.id
WHERE t.resolved_at IS NULL
GROUP BY 1
ORDER BY 1;


-- ===========================================================================
-- STEP 3 — THE ONLY WRITE.
--
-- One atomic statement. RETURNING prints every row it changed, so the output is
-- the receipt: it should match Step 1 exactly, ticket for ticket.
--
-- Safe to re-run. It only fills nulls, so a second run returns no rows.
-- ===========================================================================

WITH stamp_event AS (
  SELECT
    target_id  AS ticket_id,
    created_at,
    id         AS entry_id,
    (action = 'support_ticket_updated' AND metadata->>'status' = 'resolved') AS is_resolution
  FROM audit_log_entries
  WHERE target_type = 'SupportTicket'
    AND (
      (action = 'support_ticket_updated'
         AND metadata->>'status' IN ('resolved', 'open', 'awaiting_customer'))
      OR action = 'support_ticket_customer_reply'
    )
),
last_event AS (
  SELECT DISTINCT ON (ticket_id) ticket_id, created_at, is_resolution
  FROM stamp_event
  ORDER BY ticket_id, created_at DESC, entry_id DESC
)
UPDATE support_tickets t
SET resolved_at = e.created_at
FROM last_event e
WHERE e.ticket_id = t.id
  AND e.is_resolution
  AND t.resolved_at IS NULL
RETURNING t.ticket_number, t.status, t.resolved_at, t.closed_at;
