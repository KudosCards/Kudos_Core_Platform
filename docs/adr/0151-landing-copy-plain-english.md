# 0151 — Landing page copy: plain, human English (the "is this AI-written?" fix)

## Status

Accepted — implemented. From early customer feedback (Wave 1.5).

## Context

Early feedback on the marketing landing page was blunt: it **"reads as
AI-written"** — **"em-dashes everywhere"**, jargon like **"automated sends"**,
and **"Step 01 wording unclear"**. First-impression trust matters most on the
page web traffic lands on, and stilted, templated copy undercuts it.

## Decision

Rewrite the landing prose in plain, warm British English, keeping the layout,
images, structure, and pricing exactly as they were.

- **No em-dashes in our own copy.** Every `—` in the marketing prose was removed
  and replaced with full stops, commas or "and" (hero subhead/body, the problem
  and benefits paragraphs, the card-showcase and final-CTA lines, the benefits
  "term — definition" separator, and the Enterprise blurb).
- **Drop the jargon.** "automated sends" and "on autopilot" are gone; the copy
  now says what actually happens ("tell us the birthdays and we'll post a card
  every year", "we print and post real cards for you").
- **Clearer steps.** The "01 / 02 / 03" labels became "1 / 2 / 3", and the step
  titles are now plain and action-first: *Add the people you care about* →
  *Choose when it goes* → *We print it and post it*.
- **Consistent CTAs.** The three "Start Free — No (Credit) Card Needed" buttons
  are now a single, dash-free "Start for free, no card needed".

## What was deliberately left unchanged

- **Genuine customer testimonials** (Ann Bennett, Liz Martin, Sarah T.) and their
  attributions are **verbatim**, including any em-dashes. Editing real reviews to
  fit a style guide would misrepresent what customers actually said.
- The **brand tagline** in the logo's alt text ("Kudos Cards — Because you Care")
  and code comments are not user-facing prose and were left as-is.
- Layout, images, pricing, plan cards and the Enterprise contact tier are
  unchanged — this is a copy pass, not a redesign.

## Consequences

- The page reads like a person wrote it: shorter sentences, direct "you", no
  em-dash tic, no jargon. The steps are unambiguous.
- Purely content/presentational; no route, component, API, or dependency change.
- Copy is subjective — this is a solid, on-brand baseline for the team to tweak
  wording on directly if they want a different phrase here or there.
