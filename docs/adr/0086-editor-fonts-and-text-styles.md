# 0086 — Card editor: richer self-hosted fonts + bold/italic/underline

## Status

Accepted

## Context

Phase 1 gave the editor direct manipulation. Phase 2 starts on the creative
tools, and the highest-impact one for personalised cards is **typography**. The
editor offered four system fonts and no bold/italic. A consumer editor (Moonpig,
our reference) gives a curated font library and basic type styling.

Two constraints shaped the design:

- **Persistence durability.** A design stores `text.fontFamily` as a string and
  is re-opened/re-rendered indefinitely. `next/font` (which we already use for
  the app UI) build-*hashes* a font's CSS family name, so that name must never be
  persisted — it can change across builds/Next upgrades and would silently break
  saved designs.
- **Canvas font loading.** Konva draws text to a `<canvas>`, which does not
  participate in normal CSS font preloading, and Konva does not redraw when a
  font later arrives — so first paint uses the fallback and never corrects itself
  unless we intervene.

## Decision

1. **Store a stable key, resolve at render.** A design keeps a stable font key
   (e.g. `"Playfair Display"`, or a legacy system value like `"Helvetica"`). The
   shared catalogue `EDITOR_FONTS` (in shared-types) lists those keys, labels and
   categories — the single source the picker and both renderers agree on. The web
   app maps a key to the actual loaded family via `resolveFontFamily`
   (self-hosted web fonts → Next's hashed family; system stacks and unknown
   legacy values → themselves), so old designs are unchanged and saved designs
   survive rebuilds.

2. **Self-host via `next/font/google`.** Next fetches a curated set (Montserrat,
   Poppins, Nunito, Playfair Display, Lora, Dancing Script, Caveat, Pacifico,
   Lobster) at build time and serves them from our domain — no runtime Google
   request, CSP-friendly, matching how the app already loads Geist. Variable
   faces cover real bold + italic; single-weight display faces fall back to
   browser-synthesised bold/italic.

3. **Warm fonts + redraw.** A `FontPreloader` renders hidden text in each family
   × weight/style so the browser fetches every file up front; a `useFontsReady`
   hook (watching `document.fonts.ready` + `loadingdone`) bumps a tick the Konva
   renderers depend on, so they re-measure text and redraw once the real font is
   in use. The editor warms the whole catalogue; a read-only preview warms only
   the fonts its design uses.

4. **Bold/italic/underline as additive toggles.** `text.bold` / `italic` /
   `underline` are optional booleans (all default off → existing designs
   unchanged). Pure helpers `konvaFontStyle` (→ Konva `fontStyle`) and
   `konvaTextDecoration` (→ `textDecoration`) map them for both renderers and are
   unit-tested. The panel gains a grouped-by-category font dropdown and B/I/U
   toggle buttons.

## Consequences

- The editor now offers a real font library and bold/italic/underline, rendered
  identically in the editor and the read-only preview (both Konva, both using
  `resolveFontFamily` + the shared style helpers).
- No breaking schema change: only additive optional `text` fields; every existing
  design and template parses and renders exactly as before, and keeps its font
  across future builds because only the stable key is persisted.
- The self-hosting is verified by the web build actually fetching and bundling
  all nine faces (a broken per-font weight/style config would fail the build).
- Konva font-load timing — the classic "canvas paints the fallback" trap — is
  handled explicitly via the preloader + ready-redraw rather than left to chance.
- Follow-on Phase 2: stickers/shapes, per-page background, and canvas zoom.
