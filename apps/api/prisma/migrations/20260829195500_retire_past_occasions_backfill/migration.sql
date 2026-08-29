-- Close off the dates that already came and went with no card sent.
--
-- Three populations, all of which have been accumulating since the platform
-- launched. Run as a separate migration from the one adding the enum value,
-- because Postgres will not let a new enum value be used in the transaction
-- that created it.

-- 1. Approvals whose date has been — actioned or not. The unactioned ones were
--    previously swept to `skipped`, which told a customer they had skipped a
--    birthday they never touched; the actioned ones were never swept at all and
--    kept a green "Ready to send" badge for ever.
UPDATE "occasions"
SET status = 'missed'
WHERE status IN ('pending_approval', 'approved')
  AND occasion_date < CURRENT_DATE;

-- 2. Hand-added events (a graduation, a leaver) whose day has passed. Only
--    birthdays, renewals and anniversaries are promoted on a timer, so these sat
--    "Scheduled" for ever with a live "Prepare card" button beside them.
UPDATE "occasions"
SET status = 'missed'
WHERE status = 'scheduled'
  AND source = 'one_off_campaign'
  AND occasion_date < CURRENT_DATE;

-- 3. Rows the old sweep had already retired to `skipped`. A deliberate skip
--    records an audit entry naming who did it; the sweep recorded none. So a
--    past `skipped` occasion with no `skip` entry against it was never anyone's
--    decision, and is re-labelled to match what actually happened.
UPDATE "occasions" o
SET status = 'missed'
WHERE o.status = 'skipped'
  AND o.occasion_date < CURRENT_DATE
  AND NOT EXISTS (
    SELECT 1 FROM "audit_log_entries" a
    WHERE a.target_type = 'Occasion'
      AND a.target_id = o.id
      AND a.action = 'skip'
  );
