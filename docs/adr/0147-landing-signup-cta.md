# 0147 — A "Sign up" CTA in the public header (not just "Sign in")

## Status

Accepted — implemented. From early customer feedback (Wave 2).

## Context

A visitor noted the landing page **had no "Sign up" call-to-action — only "Sign
in"**. Looking at the public header, the single auth action was a prominent coral
**"Sign in"** button. That's backwards from the SaaS convention (the prominent
button should be the _conversion_ action, i.e. create an account), and it means a
first-time visitor scanning the header for "how do I start?" found only the
returning-user door. The only "Sign up free" affordance lived buried inside the
Reminders bell popover.

The landing body already had plenty of "Start Free" buttons, but the persistent
header — visible on every scroll and on the card-library / basket pages — did not.

## Decision

Give the public header the standard two-action auth pattern:

- **Primary "Sign up"** button (coral) → `/register` — the conversion action gets
  the prominent styling.
- **"Log in"** text link → `/login` beside it, for returning users.

Both are always visible (the header's icon labels already collapse below `sm`, so
there's room), so the sign-up path is reachable from every public page without
opening a menu.

## Consequences

- A first-time visitor now sees an obvious "Sign up" everywhere the header
  appears, matching the "Start Free" CTAs in the page body — no dependence on the
  Reminders popover to discover it.
- Returning users still have a clear "Log in", now correctly de-emphasised
  relative to the conversion action.
- Purely presentational; no route, API, or dependency change. `/register` and
  `/login` are unchanged.
