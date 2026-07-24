# ADR 0039 — Returned to Sender (RTS) service recovery

Status: accepted
Date: 2026-07-24

## Context

Royal Mail sometimes returns a card — the recipient moved, the address was incomplete/incorrect, or
delivery wasn't possible. Until now this was unstructured: no way to record it, no way to stop the
same bad address being used again, and no path for the customer to recover the card. This ADR adds a
structured RTS workflow that turns an operational failure into a premium service-recovery moment.

Confirmed with the user:
- **Kudos Promise: one fully-free recovery per returned card** — Kudos absorbs the reprint *and*
  postage. A second recovery for the same card needs a fresh paid order.
- **Flagged contacts:** automatic/scheduled sends pause hard until the case is resolved; manual
  checkout warns but is not blocked (surfaced on the contact record and list today).

## Decision

### One `ReturnCase` per returned card

Marking a card returned opens a `ReturnCase` (unique per `OrderRecipient`) that drives the whole
workflow through its status: `awaiting_address` → (customer updates the address) → `awaiting_resend`
→ (resend / hand-deliver / archive) → `resolved` | `archived`. The case, not a scatter of booleans,
is the single source of truth for the ops queue and the customer's contact-record alerts.

The two flag names in the brief ("Address Requires Update", "Address Verification Required") collapse
to **one** boolean, `Recipient.addressVerificationRequired`. While set it (a) pauses the contact's
auto-sends and (b) drives the checkout/contact warnings. It clears only when **no** open case still
needs it — recovering one returned card never un-pauses a contact with another return outstanding.

### Marking returned (ops)

`POST /admin/returns { fulfillmentJobId, reason }` (PlatformAdmin), from the fulfillment queue. Only a
`posted`/`delivered` card can be returned (it must actually have been sent); a second mark is a 409.
In one transaction it moves the job + order line to `returned_to_sender`, flags the contact, and opens
the case. After commit, best-effort, it emails the customer ("update the address" CTA) and drops an
inbox item — neither can fail the return.

### Recovery (customer)

On the contact record: an alert per open case, then the Update-Address step, then the one free
recovery — **resend to the corrected address** (`POST /returns/:id/resend`) or **hand-deliver to the
business** (`POST /returns/:id/send-to-business`), or **archive**. The free recovery creates a **£0**
`BatchOrder` and runs it through the *same* `settleFulfillment` step every paid order uses (queue the
line, create the fulfillment job, mint the QR page) — no payment, no wallet debit. The case's
`freeRecoveryUsed` is claimed with a status-guarded `updateMany` so a double-click can't mint two free
cards.

### Birthday logic

Resend-to-recipient is refused once the occasion date has passed by more than a configurable window
(`rts_birthday_passed_days`, default 7, in `PlatformSetting`). The case view carries a `resend`
eligibility block (`birthdayPassed`, `hasRecipientAddress`, `daysSinceOccasion`) so the UI offers the
right options. Hand-delivery to the business stays available regardless — it's delivering the card
already made — as does archiving.

### Auto-send pause

`AutoSendService` skips any due occasion whose recipient is flagged, with an audited
`auto_send_skipped` reason. So a returned-and-unverified contact can't be auto-fired another card at a
known-bad address until the case is resolved.

### Ops queue

`GET /admin/returns` (PlatformAdmin) lists cases with the columns the brief asks for — business,
contact, event, reason, days since return, stage (awaiting address / resend / resolved / archived),
and whether the free recovery is used — defaulting to open cases, oldest first. No street address in
the list (data minimisation, consistent with the fulfillment queue).

## Alternatives considered

- **A new fulfillment status only, no case model** — rejected: the recovery has real state (address
  updated? free recovery used? which recovery order?) that a single job status can't hold, and the ops
  queue needs to list and filter it.
- **Charging postage on the recovery** — rejected by the user; the fully-free recovery is the premium
  differentiator, and schools remember a business that fixed a failure at no cost.
- **Hard-blocking manual checkout to a flagged contact** — deferred; the brief marks it configurable
  and the hard part (auto-send pause) is the real protection. Manual checkout warns; a hard block can
  be a later PlatformSetting.
- **Customer self-updates the address straight from the email link (no login)** — the brief's "future
  enhancement" (section 8). **Now built** (see the update below).

## Consequences

- A returned card becomes a tracked, recoverable case instead of a lost card and a support email.
- The contact's future automated mailings are protected until a human verifies the address.
- The free recovery reuses the existing settle-fulfilment path, so a £0 recovery card is produced,
  QR-paged, and queued exactly like any other — no separate fulfilment code path to keep in sync.
- New env var `BREVO_RTS_TEMPLATE_ID` (optional) themes the notification email in Brevo; unset uses the
  built-in branded HTML.

## Update (2026-07-24) — self-serve recovery from the email link

The RTS email's "Update address" button now lands on a **public, no-login recovery page**
(`/rts/:token`) instead of the in-app contact record, delivering the brief's section-8 flow: the
customer opens the link → updates the address → chooses resend / hand-deliver / archive → the job
enters the print queue, all without signing in.

- **Auth is the token, nothing else.** `ReturnCase.publicToken` is a 40-char nanoid secret generated
  when the case opens, carried only in the emailed link (never returned by the account-scoped API) —
  the same credential model as invite / guest-claim links. The public API (`@Public()`, throttled
  20/min) resolves the token to `(accountId, caseId)` and **delegates to the exact same
  ReturnsService methods** the authenticated `/returns` endpoints use, so the one-free-recovery guard,
  birthday logic, flag-clearing, and £0 settle path are shared, not duplicated. A bad token is a 404 —
  indistinguishable from an unknown case, leaking nothing.
- **Minimal PII on the public page.** The page shows the recipient's name (already in the email) and
  the return reason, but **no stored address** — the update form starts blank and the customer types
  the corrected address. Actions via the link are audited under a `public:rts-link` actor.
- **Trade-off:** the token doesn't expire and isn't single-use, but the money paths are still safe —
  the free recovery is claimed with a status-guarded update (one £0 card, ever), and a resolved case
  refuses further actions. Revisiting the link after recovery just shows the "done" state.
