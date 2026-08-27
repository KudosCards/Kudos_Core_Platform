# 0054 — Dismissible / minimisable dashboard setup checklist

## Status

Accepted

## Context

The dashboard's "Let's get you set up" onboarding checklist (ADR 0022) mirrors
the three `/get-started` steps with live completion state and auto-hides once
all three are done (contacts imported, birthdays lined up, first order placed).

In practice a returning user can sit at "2 of 3 done" indefinitely — e.g. they
use auto-send and never manually place a first order, or simply don't want the
nudge. For them the checklist becomes permanent dashboard clutter with no way
to put it away. The user asked for it to be dismissible, minimisable, and
reopenable.

## Decision

Make the checklist a small interactive client component with three view states,
persisted **per browser** in `localStorage`:

- **expanded** (default) — the full three-step card.
- **collapsed / minimised** — just the header row (title + progress badge + a
  chevron), so the guide stays one click away without occupying the screen.
- **dismissed** — replaced by a slim "🎯 Show setup guide" bar (still showing
  progress) that reopens it. This is the "reopen later" affordance; the app has
  no Help menu, so keeping the entry point inline on the dashboard is the least
  surprising place for it.

Controls: the header doubles as a collapse toggle, plus explicit **Minimise /
Expand** and **Dismiss** buttons.

### Why localStorage, not an account setting

An account is shared by multiple teammates. A server-side "dismissed" flag would
hide the guide for _everyone_ on the account the moment one person dismissed it.
Dismissal is a personal "I've seen this" preference, so it belongs per browser.
No API or schema change is needed. The key is versioned (`kudos.setupChecklist.v1`)
so the steps can change later without a stale dismissal carrying over.

### Why `useSyncExternalStore`

Reading `localStorage` during render would cause an SSR/client hydration
mismatch, and reading it in an effect (`setState`) both trips our
`react-hooks/set-state-in-effect` lint rule and flashes the card in before the
stored preference is known. `useSyncExternalStore` reads the value idiomatically:
`getServerSnapshot` returns `null` (renders nothing on the server and the first
hydration pass), then the client snapshot supplies the real view — so a dismissed
guide never flashes. A custom `kudos:setup-checklist-change` window event (plus
the native `storage` event) keeps same-tab and cross-tab instances in sync.

The all-three-done auto-hide is unchanged and still wins over any stored
preference — once onboarding is genuinely complete the component renders nothing.

## Consequences

- Returning users can clear the checklist to taste; the choice sticks per
  browser and is reversible.
- No backend surface added; purely a client concern.
- A user on a new device/browser sees the guide again until they set a
  preference there — acceptable for an onboarding nudge, and it still vanishes
  on its own once all three steps are complete.
