-- P2-17 backfill — recompute stored dispatch dates under the posting-date
-- seasonal rule (ADR 0195).
--
-- WHY THIS IS NEEDED
-- `dispatch_date` is computed once and stored on the Occasion row, and the
-- nightly scheduler writes with skipDuplicates, so existing rows keep whatever
-- date they were given under the old rule. A contact whose birthday is 4 January
-- may already hold dispatch_date = 2026-12-23, computed when the seasonal window
-- was matched against the occasion date instead of the posting date. Nothing in
-- the running system will move it.
--
-- HOW THIS FILE WAS BUILT
-- The mapping below is not a re-implementation of the rule in SQL. Every row is
-- the engine's own output: `computeDispatchDate` was run over every occasion
-- date from 2026-08-31 to 2028-12-31 and compared against the old behaviour, and
-- the dates that differ are listed verbatim. There is no arithmetic here to get
-- wrong — only a lookup.
--
-- Lead days are 5 for every postage class today (POSTAGE_LEAD_DAYS in
-- shared-types), so the new dispatch date is a function of the occasion date
-- alone. If that ever stops being true, this file has to be regenerated.
--
-- SCOPE — 39 occasion dates across three seasons. Note this is wider than the
-- sizing query in ADR 0195, which looked only at January and stopped at day 8:
--   * December 1-7 occasions LOSE the extra lead (they were posting ~5 days
--     earlier than they needed to). Not covered by that query at all.
--   * January occasions GAIN lead, moving off the 23-31 December peak. In the
--     2028 season the affected range runs to 10 January, not 8.
--
-- HOW TO RUN IT
-- Step by step, not as one blob. Step 3 opens a transaction and deliberately
-- does not close it, so you get to read the row count before deciding; running
-- the whole file in one go would leave that transaction open and roll it back
-- when the session ends. Paste one step, read what it says, move on.
--
-- BEFORE YOU RUN ANYTHING
-- Step 0 checks that production is still on the bundled seasonal rules. The
-- windows are admin-configurable, and if someone has edited them this mapping
-- is wrong and must be regenerated against the live rules.

-- ---------------------------------------------------------------------------
-- STEP 0 — confirm the seasonal rules are still the bundled default.
-- Expect either NO ROW (never edited) or exactly the JSON shown.
-- ---------------------------------------------------------------------------
SELECT key, value, updated_at
FROM platform_settings
WHERE key = 'dispatch_seasonal_rules';
-- Expected when edited-but-unchanged:
--   [{"label":"Christmas post rush","from":{"month":12,"day":1},
--     "to":{"month":12,"day":31},"extraLeadDays":3,"suggestFirstClass":true}]
-- Anything else  ->  STOP. Regenerate the mapping against the live rules.

-- ---------------------------------------------------------------------------
-- STEP 1 — sizing. Read-only. How many rows would move, and by how much.
-- ---------------------------------------------------------------------------
WITH remap (occasion_date, old_dispatch, new_dispatch) AS (
  VALUES
    (DATE '2026-12-01', DATE '2026-11-19', DATE '2026-11-24'),
    (DATE '2026-12-02', DATE '2026-11-20', DATE '2026-11-25'),
    (DATE '2026-12-03', DATE '2026-11-23', DATE '2026-11-26'),
    (DATE '2026-12-04', DATE '2026-11-24', DATE '2026-11-27'),
    (DATE '2026-12-05', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-06', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-07', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2027-01-01', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-02', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-03', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-04', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-05', DATE '2026-12-24', DATE '2026-12-21'),
    (DATE '2027-01-06', DATE '2026-12-29', DATE '2026-12-22'),
    (DATE '2027-01-07', DATE '2026-12-30', DATE '2026-12-23'),
    (DATE '2027-01-08', DATE '2026-12-31', DATE '2026-12-24'),
    (DATE '2027-12-01', DATE '2027-11-19', DATE '2027-11-24'),
    (DATE '2027-12-02', DATE '2027-11-22', DATE '2027-11-25'),
    (DATE '2027-12-03', DATE '2027-11-23', DATE '2027-11-26'),
    (DATE '2027-12-04', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-05', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-06', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-07', DATE '2027-11-25', DATE '2027-11-30'),
    (DATE '2028-01-01', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-02', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-03', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-04', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-05', DATE '2027-12-24', DATE '2027-12-21'),
    (DATE '2028-01-06', DATE '2027-12-29', DATE '2027-12-22'),
    (DATE '2028-01-07', DATE '2027-12-30', DATE '2027-12-23'),
    (DATE '2028-01-08', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-09', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-10', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-12-01', DATE '2028-11-21', DATE '2028-11-24'),
    (DATE '2028-12-02', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-03', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-04', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-05', DATE '2028-11-23', DATE '2028-11-28'),
    (DATE '2028-12-06', DATE '2028-11-24', DATE '2028-11-29'),
    (DATE '2028-12-07', DATE '2028-11-27', DATE '2028-11-30')

)
SELECT
  r.occasion_date,
  r.old_dispatch,
  r.new_dispatch,
  r.new_dispatch - r.old_dispatch AS shift_days,
  count(*) AS occasions
FROM occasions o
JOIN remap r ON r.occasion_date = o.occasion_date AND r.old_dispatch = o.dispatch_date
WHERE o.status IN ('scheduled', 'pending_approval', 'approved')
  AND o.dispatch_date_overridden = false
GROUP BY r.occasion_date, r.old_dispatch, r.new_dispatch
ORDER BY r.occasion_date;

-- ---------------------------------------------------------------------------
-- STEP 2 — rows that are in scope but do NOT hold the old computed value.
-- Read-only. These are deliberately left alone; this query is so you can see
-- them rather than wonder later. Expect few or none.
-- ---------------------------------------------------------------------------
WITH remap (occasion_date, old_dispatch, new_dispatch) AS (
  VALUES
    (DATE '2026-12-01', DATE '2026-11-19', DATE '2026-11-24'),
    (DATE '2026-12-02', DATE '2026-11-20', DATE '2026-11-25'),
    (DATE '2026-12-03', DATE '2026-11-23', DATE '2026-11-26'),
    (DATE '2026-12-04', DATE '2026-11-24', DATE '2026-11-27'),
    (DATE '2026-12-05', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-06', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-07', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2027-01-01', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-02', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-03', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-04', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-05', DATE '2026-12-24', DATE '2026-12-21'),
    (DATE '2027-01-06', DATE '2026-12-29', DATE '2026-12-22'),
    (DATE '2027-01-07', DATE '2026-12-30', DATE '2026-12-23'),
    (DATE '2027-01-08', DATE '2026-12-31', DATE '2026-12-24'),
    (DATE '2027-12-01', DATE '2027-11-19', DATE '2027-11-24'),
    (DATE '2027-12-02', DATE '2027-11-22', DATE '2027-11-25'),
    (DATE '2027-12-03', DATE '2027-11-23', DATE '2027-11-26'),
    (DATE '2027-12-04', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-05', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-06', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-07', DATE '2027-11-25', DATE '2027-11-30'),
    (DATE '2028-01-01', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-02', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-03', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-04', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-05', DATE '2027-12-24', DATE '2027-12-21'),
    (DATE '2028-01-06', DATE '2027-12-29', DATE '2027-12-22'),
    (DATE '2028-01-07', DATE '2027-12-30', DATE '2027-12-23'),
    (DATE '2028-01-08', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-09', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-10', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-12-01', DATE '2028-11-21', DATE '2028-11-24'),
    (DATE '2028-12-02', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-03', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-04', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-05', DATE '2028-11-23', DATE '2028-11-28'),
    (DATE '2028-12-06', DATE '2028-11-24', DATE '2028-11-29'),
    (DATE '2028-12-07', DATE '2028-11-27', DATE '2028-11-30')

)
SELECT o.id, o.occasion_date, o.dispatch_date AS actual, r.old_dispatch AS expected_old,
       r.new_dispatch, o.status, o.dispatch_date_overridden
FROM occasions o
JOIN remap r ON r.occasion_date = o.occasion_date
WHERE o.status IN ('scheduled', 'pending_approval', 'approved')
  AND (o.dispatch_date IS DISTINCT FROM r.old_dispatch OR o.dispatch_date_overridden)
ORDER BY o.occasion_date;

-- ---------------------------------------------------------------------------
-- STEP 3 — the backfill. Wrapped so you can read the count before committing.
-- ---------------------------------------------------------------------------
BEGIN;

WITH remap (occasion_date, old_dispatch, new_dispatch) AS (
  VALUES
    (DATE '2026-12-01', DATE '2026-11-19', DATE '2026-11-24'),
    (DATE '2026-12-02', DATE '2026-11-20', DATE '2026-11-25'),
    (DATE '2026-12-03', DATE '2026-11-23', DATE '2026-11-26'),
    (DATE '2026-12-04', DATE '2026-11-24', DATE '2026-11-27'),
    (DATE '2026-12-05', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-06', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-07', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2027-01-01', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-02', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-03', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-04', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-05', DATE '2026-12-24', DATE '2026-12-21'),
    (DATE '2027-01-06', DATE '2026-12-29', DATE '2026-12-22'),
    (DATE '2027-01-07', DATE '2026-12-30', DATE '2026-12-23'),
    (DATE '2027-01-08', DATE '2026-12-31', DATE '2026-12-24'),
    (DATE '2027-12-01', DATE '2027-11-19', DATE '2027-11-24'),
    (DATE '2027-12-02', DATE '2027-11-22', DATE '2027-11-25'),
    (DATE '2027-12-03', DATE '2027-11-23', DATE '2027-11-26'),
    (DATE '2027-12-04', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-05', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-06', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-07', DATE '2027-11-25', DATE '2027-11-30'),
    (DATE '2028-01-01', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-02', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-03', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-04', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-05', DATE '2027-12-24', DATE '2027-12-21'),
    (DATE '2028-01-06', DATE '2027-12-29', DATE '2027-12-22'),
    (DATE '2028-01-07', DATE '2027-12-30', DATE '2027-12-23'),
    (DATE '2028-01-08', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-09', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-10', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-12-01', DATE '2028-11-21', DATE '2028-11-24'),
    (DATE '2028-12-02', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-03', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-04', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-05', DATE '2028-11-23', DATE '2028-11-28'),
    (DATE '2028-12-06', DATE '2028-11-24', DATE '2028-11-29'),
    (DATE '2028-12-07', DATE '2028-11-27', DATE '2028-11-30')

)
UPDATE occasions o
SET dispatch_date = r.new_dispatch
FROM remap r
WHERE r.occasion_date = o.occasion_date
  -- Only rows still holding the value the old rule produced. A row someone has
  -- since changed by another route is not ours to overwrite.
  AND o.dispatch_date = r.old_dispatch
  -- A date a human dragged on the calendar must never be recomputed (ADR 0058).
  AND o.dispatch_date_overridden = false
  -- Nothing past approval: from `queued` on there is an order, and the
  -- fulfilment job carries its own due date.
  AND o.status IN ('scheduled', 'pending_approval', 'approved');

-- Compare this count against STEP 1 before deciding.
-- COMMIT;   -- uncomment to apply
-- ROLLBACK; -- or this to walk away

-- ---------------------------------------------------------------------------
-- STEP 4 — after committing, this must return no rows.
-- ---------------------------------------------------------------------------
WITH remap (occasion_date, old_dispatch, new_dispatch) AS (
  VALUES
    (DATE '2026-12-01', DATE '2026-11-19', DATE '2026-11-24'),
    (DATE '2026-12-02', DATE '2026-11-20', DATE '2026-11-25'),
    (DATE '2026-12-03', DATE '2026-11-23', DATE '2026-11-26'),
    (DATE '2026-12-04', DATE '2026-11-24', DATE '2026-11-27'),
    (DATE '2026-12-05', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-06', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2026-12-07', DATE '2026-11-25', DATE '2026-11-30'),
    (DATE '2027-01-01', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-02', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-03', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-04', DATE '2026-12-23', DATE '2026-12-18'),
    (DATE '2027-01-05', DATE '2026-12-24', DATE '2026-12-21'),
    (DATE '2027-01-06', DATE '2026-12-29', DATE '2026-12-22'),
    (DATE '2027-01-07', DATE '2026-12-30', DATE '2026-12-23'),
    (DATE '2027-01-08', DATE '2026-12-31', DATE '2026-12-24'),
    (DATE '2027-12-01', DATE '2027-11-19', DATE '2027-11-24'),
    (DATE '2027-12-02', DATE '2027-11-22', DATE '2027-11-25'),
    (DATE '2027-12-03', DATE '2027-11-23', DATE '2027-11-26'),
    (DATE '2027-12-04', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-05', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-06', DATE '2027-11-24', DATE '2027-11-29'),
    (DATE '2027-12-07', DATE '2027-11-25', DATE '2027-11-30'),
    (DATE '2028-01-01', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-02', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-03', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-04', DATE '2027-12-23', DATE '2027-12-20'),
    (DATE '2028-01-05', DATE '2027-12-24', DATE '2027-12-21'),
    (DATE '2028-01-06', DATE '2027-12-29', DATE '2027-12-22'),
    (DATE '2028-01-07', DATE '2027-12-30', DATE '2027-12-23'),
    (DATE '2028-01-08', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-09', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-01-10', DATE '2027-12-31', DATE '2027-12-24'),
    (DATE '2028-12-01', DATE '2028-11-21', DATE '2028-11-24'),
    (DATE '2028-12-02', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-03', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-04', DATE '2028-11-22', DATE '2028-11-27'),
    (DATE '2028-12-05', DATE '2028-11-23', DATE '2028-11-28'),
    (DATE '2028-12-06', DATE '2028-11-24', DATE '2028-11-29'),
    (DATE '2028-12-07', DATE '2028-11-27', DATE '2028-11-30')

)
SELECT o.id, o.occasion_date, o.dispatch_date, r.new_dispatch
FROM occasions o
JOIN remap r ON r.occasion_date = o.occasion_date AND r.old_dispatch = o.dispatch_date
WHERE o.status IN ('scheduled', 'pending_approval', 'approved')
  AND o.dispatch_date_overridden = false;

-- ---------------------------------------------------------------------------
-- STEP 5 — occasions the engine cannot date correctly yet. Read-only.
-- UK_BANK_HOLIDAYS in shared-types runs to the end of 2028. Any open occasion
-- dated 2029 or later already has a dispatch date computed against an
-- incomplete holiday list, and this backfill does not cover it. Extend the
-- bundled list before that matters.
-- ---------------------------------------------------------------------------
SELECT count(*) AS open_occasions_beyond_the_holiday_horizon
FROM occasions
WHERE status IN ('scheduled', 'pending_approval', 'approved')
  AND occasion_date >= DATE '2029-01-01';
