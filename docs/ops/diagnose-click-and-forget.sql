-- Why is only one contact captured by click and forget?
--
-- Chris's report: Izobella Ross is scheduled to auto-send on 8 October, but the
-- calendar shows several other students, some of them sooner, that were not
-- picked up.
--
-- A card reaches auto-send only by passing three gates in order:
--
--   1. 06:00  promote-due-occasions  scheduled -> pending_approval
--              needs: type in (birthday, renewal, anniversary)
--                     recipient.status = 'active'
--                     occasion_date between today and today + 21 days
--   2. 06:30  standing-order approval  pending_approval -> approved + auto_send
--              needs: type = 'birthday'
--                     source = 'recurring_per_recipient'
--                     recipient.status = 'active'
--                     in the instruction's list, when it targets one
--   3. 07:00  auto-send  approved + auto_send + dispatch_date <= today -> ordered
--
-- Each gate is invisible from the calendar, which shows an occasion as
-- "Upcoming" whenever its recipient is merely not archived. This says which
-- gate each contact is stuck at, rather than that they are stuck.
--
-- Read-only. Replace the account id on the line below.

\set account_id 'REPLACE-WITH-ACCOUNT-ID'

SELECT
  r.first_name || ' ' || r.last_name        AS contact,
  o.occasion_date,
  o.dispatch_date,
  o.type,
  o.source,
  o.status,
  o.dispatch_option,
  r.status                                  AS recipient_status,
  o.saved_design_id IS NOT NULL             AS has_design,
  CASE
    WHEN o.status IN ('approved','queued','printed','posted','delivered')
      THEN 'fine — already past approval'
    WHEN r.status <> 'active'
      THEN 'GATE 1+2: recipient is ' || r.status || ', which both crons exclude'
    WHEN o.type NOT IN ('birthday','renewal','anniversary')
      THEN 'GATE 1: type ' || o.type || ' is never promoted on a timer'
    WHEN o.status = 'scheduled' AND o.occasion_date > CURRENT_DATE + 21
      THEN 'fine — outside the 21-day window, will promote later'
    WHEN o.status = 'scheduled'
      THEN 'GATE 1: in window but still scheduled — the 06:00 cron has not promoted it'
    WHEN o.status = 'pending_approval' AND o.type <> 'birthday'
      THEN 'GATE 2: click and forget only approves birthdays'
    WHEN o.status = 'pending_approval' AND o.source <> 'recurring_per_recipient'
      THEN 'GATE 2: source is ' || o.source || ', so click and forget skips it'
    WHEN o.status = 'pending_approval'
      THEN 'GATE 2: eligible but not approved — check the list filter and blockers below'
    ELSE 'other: ' || o.status
  END                                       AS diagnosis
FROM occasions o
JOIN recipients r ON r.id = o.recipient_id
WHERE o.account_id = :'account_id'
  AND o.occasion_date >= CURRENT_DATE
  AND o.occasion_date <= CURRENT_DATE + 45
ORDER BY o.occasion_date;

-- The instruction itself: is it enabled, and does it target a list that the
-- missing contacts are not in?
SELECT
  s.id,
  s.enabled,
  s.audience_kind,
  s.recipient_list_id,
  s.segment_id,
  s.postage_class,
  (SELECT count(*) FROM standing_order_designs d WHERE d.standing_order_id = s.id)  AS designs,
  (SELECT count(*) FROM standing_order_messages m WHERE m.standing_order_id = s.id) AS messages
FROM standing_orders s
WHERE s.account_id = :'account_id';

-- Contacts by status. A 'lapsed' contact still appears on the calendar but is
-- excluded by both crons, and nothing in the product sets that status or
-- explains it.
SELECT status, count(*) FROM recipients
WHERE account_id = :'account_id'
GROUP BY status ORDER BY status;

-- What the approvals badge counts, with no date bound at all — compare against
-- what the Approvals page listed when the screenshot was taken.
SELECT count(*) AS badge_would_show
FROM occasions o
JOIN recipients r ON r.id = o.recipient_id
WHERE o.account_id = :'account_id'
  AND o.status = 'pending_approval'
  AND r.status <> 'archived';
