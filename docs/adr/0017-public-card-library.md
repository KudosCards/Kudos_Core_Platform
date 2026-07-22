# ADR 0017 — Public card library: browse → personalise → sign up

Status: accepted
Date: 2026-07-22

## Context

The signup-to-first-order journey was account-first and tool-fragmented: a visitor had to sign up,
then assemble a card across ~11 back-office pages. Moonpig (the reference the user asked us to draw
from) does the opposite — a visitor **browses cards first, with no account**, and only hits the
signup wall when they commit to personalising one. We want that "try before you sign up" hook,
adapted to Kudos' B2B recognition context.

The chosen shape (a deliberate "half Moonpig"): let anyone browse the card library and open a card,
then make **"Personalise this card"** the moment we ask them to sign up. Personalisation itself
happens *after* signup — so there is **no guest editor and no anonymous data**, which keeps the
build and the security surface small.

## Decision

```
/cards (public gallery) → /cards/[id] (public preview + "Personalise this card")
        │ logged out                                   │ logged in
        ▼                                               ▼
  /register?card=ID  →  sign up + account  →  /start  →  creates a saved design
                                                        →  /designs/[ID]/edit  (personalise)
```

- **The catalog is public.** `GET /card-designs` and `GET /card-designs/:id` are marked `@Public()`,
  opting out of the global JWT guard. They already only return `isActive` templates and carry no
  account data, so this exposes nothing sensitive. Every other route stays guarded (an e2e test pins
  that `/recipients` still 401s without a token).
- **Public web pages live outside the `(app)` group**, so they inherit no session requirement:
  `/cards` (gallery with category filter) and `/cards/[id]` (preview + CTA), styled to match the
  marketing landing page, not the app shell. A tiny `publicApiFetch` helper does the unauthenticated
  read and degrades to an empty grid on failure.
- **The CTA is the paywall.** Logged in → create a saved design from the template and go straight to
  the editor. Logged out → stash the chosen card and route into `/register?card=ID`.
- **Carry-through across signup** uses `localStorage` (`kudos:pendingCardId`) as the primary carrier
  — it survives the whole multi-hop flow (register → optional email confirm → account setup) in the
  same browser — with the `?card=` param as a backup. A single authenticated route, **`/start`**,
  consumes it: it creates the saved design and redirects into `/designs/[id]/edit`, or forwards to
  the dashboard when nothing is pending. `register`, `login`, and `onboarding` route to `/start`
  only when a card is pending, so normal sign-ins are unaffected.

## Alternatives considered

- **Full Moonpig (guest editor):** let visitors personalise *before* signing up, persisting an
  anonymous design. Rejected for now — it needs guest/anonymous state, a merge-on-signup step, and a
  bigger abuse surface, for a marginal gain over "sign up at the personalise click." Can revisit.
- **Carrying the card purely via a query param** through every hop. Rejected as the primary
  mechanism: email confirmation can land in a different tab/context and drop the param; localStorage
  is more robust for the same-browser flow. The param is kept as a secondary carrier.

## Consequences

- New public surface: the catalog is now internet-reachable unauthenticated. It's read-only,
  active-only, non-sensitive marketing content — acceptable and intended. Worth remembering if
  future fields are ever added to `CardDesign`.
- **Email-confirmation caveat (config, not code):** for the *seamless* version (sign up → straight
  into the editor), Supabase email confirmation should be off, or its confirmation redirect should
  return to `/start`. With confirmation on, the flow still completes — the user confirms, logs in,
  and `login` forwards them to `/start` because the pending card is still in localStorage.
- This is the front door only (browse → personalise → sign up → editor). Carrying the journey all
  the way to a *sent* first order (recipient + checkout in one guided flow) is the natural next step.
