-- Hand seven already-approved cards to the automation that should have had them
--
-- These cards are approved, designed and dated, but carry dispatch_option
-- 'asap' on an account whose owner switched click and forget on. Nothing will
-- send them: the auto-send cron only ever acts on 'auto_send'. After the
-- birthday they are retired as 'missed', with no card sent and nothing said.
-- See docs/click-and-forget-capture-recon.md.
--
-- Flipping the flag is safe to do by hand because the cron re-checks every gate
-- at send time and skips with a reason rather than posting blindly: address
-- present, address not awaiting re-verification after a return, plan permits
-- auto-send, wallet covers it. This grants no permission the account does not
-- already have — the standing order is enabled, which is that permission.
--
-- RUN THE SELECT FIRST. It is the same WHERE clause as the UPDATE, so what it
-- lists is exactly what will change.

-- Preview.
SELECT
  r.first_name || ' ' || r.last_name AS contact,
  o.occasion_date,
  o.dispatch_date,
  o.status,
  o.dispatch_option,
  o.postage_class
FROM occasions o
JOIN recipients r ON r.id = o.recipient_id
JOIN accounts   a ON a.id = o.account_id
JOIN standing_orders s ON s.account_id = a.id AND s.enabled = true
WHERE a.name = 'Darlington Kip McGrath'
  AND o.status = 'approved'
  AND o.dispatch_option = 'asap'
  AND o.type = 'birthday'
  AND o.source = 'recurring_per_recipient'
  AND o.saved_design_id IS NOT NULL
  AND r.status = 'active'
  AND o.dispatch_date >= CURRENT_DATE
ORDER BY o.dispatch_date;

-- Apply. Bounded to one account, to cards a human already approved, to
-- birthdays the standing order covers, and to dispatch dates that have not
-- passed — a card whose posting date has gone is not made good by sending it
-- late, and that is the account's call rather than ours.
UPDATE occasions o
SET dispatch_option = 'auto_send',
    updated_at      = now()
FROM recipients r, accounts a, standing_orders s
WHERE r.id = o.recipient_id
  AND a.id = o.account_id
  AND s.account_id = a.id
  AND s.enabled = true
  AND a.name = 'Darlington Kip McGrath'
  AND o.status = 'approved'
  AND o.dispatch_option = 'asap'
  AND o.type = 'birthday'
  AND o.source = 'recurring_per_recipient'
  AND o.saved_design_id IS NOT NULL
  AND r.status = 'active'
  AND o.dispatch_date >= CURRENT_DATE;

-- Reverse, if it needs reversing. Only rows still untouched by the cron can go
-- back: anything it has already taken is 'queued' or beyond and is a real order
-- with money against it.
--
-- UPDATE occasions o
-- SET dispatch_option = 'asap'
-- FROM accounts a
-- WHERE a.id = o.account_id
--   AND a.name = 'Darlington Kip McGrath'
--   AND o.status = 'approved'
--   AND o.dispatch_option = 'auto_send'
--   AND o.updated_at > now() - interval '1 hour';
