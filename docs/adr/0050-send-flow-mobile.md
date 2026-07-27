# ADR 0050: Send flows — mobile pass

Status: Accepted
Date: 2026-07-27

## Context

`/designs/[id]/send` (`SendCardClient`) is the guided "send this card" checkout
the card editor's CTA leads to: an address form + postage choice + order summary
that hands off to Stripe. It was functional but desktop-shaped on a phone:

- The **address form had no autofill hints**, so a mobile user typed their whole
  address by hand.
- On mobile the two columns stack, so the **order total and "Pay & send" button
  sat at the very bottom** — the user had to scroll past the entire form to pay.
- Text inputs were `text-sm` (14px), which makes **iOS Safari zoom in** on focus.
- Small input / radio tap targets.

## Decision

A focused mobile pass on this flow.

- **Autofill + keyboard hints.** Each address field gets the right `autoComplete`
  token (`given-name`, `family-name`, `address-line1/2`, `address-level2`,
  `postal-code`) and `autoCapitalize`, so the phone offers one-tap address
  autofill and the correct casing/keyboard.
- **Sticky mobile checkout bar.** A `fixed` bottom bar (`lg:hidden`) shows the
  live estimated total and a "Pay & send" button that's always in reach; it
  submits the form via the `form="send-card-form"` attribute and respects the
  iPhone home-indicator safe area (`env(safe-area-inset-bottom)`). The container
  gets bottom padding so nothing hides behind it. On desktop the CTA stays in the
  summary column (the bar is hidden).
- **No iOS zoom.** Inputs are `text-base` (16px) on mobile, `sm:text-sm` on
  desktop, so focusing a field doesn't trigger Safari's auto-zoom. Padding bumped
  to `py-2.5` for a comfier target.
- **Tappable postage rows.** The postage radios become full-width bordered rows
  with a selected highlight — a much bigger touch target than a bare radio.

## Consequences

- Filling and paying for a card on a phone is a one-hand, autofill-assisted flow
  with the price and CTA always visible — no scroll-to-pay.
- Presentational only — no API/data change; the same `quick-send` + Stripe
  checkout handoff runs underneath.
- Verified: web lint/typecheck/build green. As a responsive/checkout change, the
  real proof is on a device — check via the deploy preview's mobile QR.

## Bulk send (`/send`) — same treatment

The bulk-send flow (pick one design → send to every mailable contact) had the
same shape problem: on mobile the "Pay & send N cards" CTA + total sat at the
bottom, below the design picker, personalisation previews, and contact list. It
got the matching changes:

- **Sticky mobile checkout bar** with the live total + card count and an
  always-in-reach "Pay & send" button (`lg:hidden`; desktop keeps the CTA in the
  summary column), safe-area aware, with bottom padding on the container.
- **Tappable postage rows** (same as the guided flow).
- **Bigger "Remove" targets** on the contact rows.

No address-form changes here — bulk send addresses come from the contact records,
so there are no inputs to autofill. Same `bulk-send` + Stripe handoff underneath.
