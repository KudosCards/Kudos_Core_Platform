# ADR 0024 — Second mobile polish pass + calendar list-view default

Status: accepted
Date: 2026-07-22

## Context

A second phone-width pass across the site, following the first (ADR 0021). This time the public
pages were rendered in a real headless Chromium at 390×844 (iPhone-class) and checked for horizontal
overflow, and the authenticated pages were audited statically.

## Findings

The site is in good mobile shape. Concretely:

- **No horizontal overflow** on the landing, login, register, or card-library pages at 390px
  (`document.scrollWidth === clientWidth` on all four).
- The auth pages (login example) render the logo, form, and CTA cleanly with generous tap targets.
- The marketing landing collapses to a single column; its top nav hides secondary links on mobile
  and keeps Log in / Start free.
- Authenticated list pages already use wrapping headers (`flex flex-col` or `flex-wrap`), responsive
  grids (`sm:`/`lg:` prefixes), and horizontally-scrolling tables (`overflow-x-auto` + `min-w-[…]`).

So this pass is targeted, not a redesign — earlier discipline held up.

## Decision

**Calendar defaults to the list view on phones.** The month and week grids need ~560px to be
legible and are wrapped in a horizontal scroller (`min-w-[560px]`), so on a 390px phone they require
sideways scrolling. The list view is the mobile-native way to read upcoming occasions, so the
calendar now defaults to it on narrow screens.

Implementation detail worth recording: the view is *derived*, not set in an effect.

```ts
const isNarrow = useSyncExternalStore(subscribeToMediaQuery, () => mql.matches, () => false);
const [viewOverride, setView] = useState<CalendarView | null>(null);
const view = viewOverride ?? (isNarrow ? "list" : "month");
```

- `useSyncExternalStore` with a server snapshot of `false` means the server and the first client
  render both compute `view = "month"` → **no hydration mismatch** → then it corrects to `list` on a
  phone after mount.
- An explicit view pick sets `viewOverride`, which wins over the media query — so a user on a phone
  can still switch to month/week and stay there.
- This avoids the `react-hooks/set-state-in-effect` lint rule (a `useEffect`+`setView` version trips
  it), the same pattern already used for the localStorage reads in the onboarding flow.

## Alternatives considered

- **Making the month grid fit 390px.** Rejected — seven legible day columns don't fit a phone; the
  honest options are horizontal scroll (kept, for users who switch back to month) or the list view
  (now the default).
- **A lazy `useState` initializer reading `matchMedia`.** Rejected — it runs during the first client
  render and would disagree with the server's "month", causing a hydration mismatch.

## Consequences

- On a phone, the calendar opens straight into a readable list; month/week remain one tap away and
  scroll horizontally when chosen.
- Purely presentational; no API/schema/test-surface change.
- **Noted for the brand backlog (not fixed here):** the `logo.png` asset carries a white
  background, so on the light-grey auth pages it reads as a faint white tile. A transparent-
  background version of the asset would drop straight in (no code change) — flagged to the owner
  since it's a brand-asset edit, not a layout one.
