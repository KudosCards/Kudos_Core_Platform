# 0135 — Icon library (lucide-react) replacing functional UI emoji

## Status

Accepted

## Context

The web app used inline Unicode emoji as UI icons — 🖨 print, 🚚 dispatch,
📅 calendar, 📌 pin, 🔌 plug, 🔍 review, 🎂 birthday, etc. — scattered across
~20 components. Emoji-as-icons render inconsistently across platforms (each OS
draws its own glyph), can't be sized or coloured to match the design, don't
inherit `currentColor`, and read poorly to assistive tech. There was no icon
library in the project.

## Decision

Adopt **lucide-react** as the icon library and replace the _functional_ UI
emoji with it. lucide is the common modern default for React/Next/Tailwind:
tree-shakeable (only imported icons ship), MIT, no runtime/external requests
(icons are inline SVG components), and sized/coloured via `className`
(`h-4 w-4`, `text-accent`, inherits `currentColor`).

**A deliberate classification decides what gets replaced:**

- **Replaced — emoji acting as an icon** for an action, status, nav item, or
  category: print/dispatch/calendar/pin/plug/search/target/truck, the
  first-class "nudge" (⚡→`Zap`), birthday _type_ markers (🎂→`Cake`), the
  pre-send checklist icons (📮📍✍🔁), file-type glyphs (🎬🖼), and the
  RTS success state (✅👍). Rendered `aria-hidden` — the adjacent text label
  carries the meaning.
- **Left as-is — content, not chrome:** the message-page emoji _palette_ and a
  page's chosen emoji (user-selected content), the public message-page/reply
  💌 decoration, celebratory 🎉 in sentences ("you're all caught up", success
  pages), the card-designer ♥ shape glyph, and the marketing 🟢 bullet.
- **Left as-is — typographic symbols:** arrows (→ ← ↑ ↓), `✓`, `✕`, `★`, `⌘`.
  These aren't emoji in the problematic sense and converting them (→ alone
  appears 90×) would be churn without benefit.

One diagnostic string (`✅ connected`/`❌ failed` in the Click & Drop test
output) had its emoji dropped to plain words rather than restructured into JSX.

## Consequences

- Functional icons now render identically on every platform, scale with the
  text, and follow the theme colour.
- Bundle impact is minimal — lucide is tree-shaken, so only the ~15 icons used
  are included.
- The pattern for new UI: `import { X } from "lucide-react"` and
  `<X className="h-4 w-4" aria-hidden />` beside a text label; no new emoji as
  icons.
- Not done: converting the decorative/content emoji (they're intentional
  product warmth and user content), and no separate brand-logo set for the
  integrations (Stripe/HubSpot/Zapier) — out of scope here.
