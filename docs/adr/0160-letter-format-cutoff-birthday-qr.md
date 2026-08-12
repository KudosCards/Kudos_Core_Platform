# 0160 — Letter postage, same-day cut-off, birthday-timed dispatch, printed QR

## Status

Accepted — implemented.

## Context

Four independent production issues, batched into one change:

1. **"Send now" ignores the day's last post.** Dispatch is purely date-based:
   a "Send now" order always dated its post-by (`dispatchDate`) to *today*,
   regardless of the clock. An order placed after Royal Mail's daily collection
   (or on a weekend/bank holiday) still read as "due today" in the ops queue for
   a collection that had already gone — so it looked overdue the moment it landed.

2. **Birthday/event sends post on the wrong day.** A bulk send to an occasion
   segment (e.g. "upcoming birthdays") reused each natural occasion as its send
   record (ADR 0119) but overwrote every reused occasion's `dispatchDate` with a
   single batch-wide value — today for "Send now". So a birthday segment posted
   *every* card today instead of timing each to its own birthday.

3. **Royal Mail format hard-coded to Large Letter.** Both the Click & Drop and
   Shipping API clients imported every order as `largeLetter`, buying a more
   expensive postage band than our A6 cards need.

4. **Printed QR is a blank box.** The ops print run renders each card with
   `CardFacePreview`, whose QR branch drew a grey placeholder square. The real
   per-card `/r/<slug>` link (minted at settlement) was never injected, so every
   printed QR card came out with an empty box.

## Decision

### 1. Same-day cut-off for "Send now"

A new pure helper `sendNowDispatchDate(now, cutoffHour, options)` in
`@kudos/shared-types`: a "Send now" card ordered on a working day **before** the
cut-off posts today; ordered at/after it — or on a weekend/bank holiday — it
posts the next working day. The cut-off is judged in **UK local time**
(`Intl` `Europe/London`), so it's correct across BST/GMT rather than drifting an
hour with a naive UTC compare.

The cut-off hour is **admin-configurable** (default **15:00**), carried on the
existing `DispatchReminderConfig` (`sameDayCutoffHour`) and edited on the ops
dispatch panel. `DispatchConfigService` pushes it into the engine's process-wide
active value (mirroring `setSeasonalDispatchRules`) on boot, on its reload timer
and immediately on an edit — so `resolveSendSchedule` picks it up with no new
injection. The web `SendTimingPicker` shows the resulting post-day under **Send
now** ("Today's post has gone — we post it <date>"); the server stays
authoritative, the picker uses the shared default.

### 2. Birthday/event cards dispatch from their own date

In `bulkSend`, reconciled occasions now compute `dispatchDate` from **their own**
`occasionDate` (send-by-5 working days before it) via `computeDispatchDate`,
never the batch's send-timing. Updates are grouped by computed dispatch date so
it stays one `updateMany` per distinct date. The batch send-timing is consulted
only for fresh bespoke occasions. In the composer, a **pure event send** (every
card maps to a consumed occasion) hides the manual date picker and shows "Each
card posts automatically, timed to arrive for its own <occasion>"; the manual
date only appears for bespoke cards with no date.

### 3. Letter, not Large Letter

`PACKAGE_FORMAT`/`packageType` changed from `largeLetter` to `letter` in both
`click-and-drop-client.ts` and `royal-mail-client.ts`. **Caveat:** Royal Mail
Letter caps at 100 g / 5 mm and our `CARD_WEIGHT_GRAMS` is exactly 100 g — at the
band edge. If a card + envelope exceeds it in practice, revisit the band.

### 4. Real per-card QR on the print run

`printRun` now returns each card's `messagePageSlug` (via
`orderRecipient.messagePageLink.slug`). `CardFacePreview` takes an optional
`qrUrl`; when set, a QR element renders as a real scannable code (via `lib/qr`),
else it keeps the placeholder square (designer preview, before a code is minted).
The print overlay builds `qrUrl = <origin>/r/<slug>` per card — the same way the
Messages page does — and passes it down, so a printed card scans to its page.

## Consequences

- "Send now" orders placed after the cut-off no longer read as overdue-on-arrival;
  the customer sees the true posting day before paying.
- Birthday/segment sends arrive around each recipient's date, not all at once.
- Lower postage cost per card (subject to the weight caveat above).
- Printed QR cards are scannable.
- `sameDayCutoffHour` is a required field on the reminder config; a stored config
  without it fails validation and falls back to the default (which includes 15).
- New unit coverage for `sendNowDispatchDate` (cut-off, BST correctness, weekend
  roll-over); the reconcile e2e now asserts birthday-timed dispatch instead of
  today.
