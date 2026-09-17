# 0248 — One rule for artwork, refused twice

## Status

Accepted

## Context

Phase 3 of docs/card-print-quality-plan.md.

A page background **is** the card: drawn full-bleed and centre-cropped by every
renderer, so its shape decides what survives and its pixel count decides how
sharp it is. Until now every check on it was advisory — the editor's crop note,
the DPI note, the ops pre-flight banner. A wrong-shaped or soft background could
be saved, ordered, snapshotted onto the order line (ADR 0242) and printed, and
the first chance anyone had to stop it was an operator reading a warning on the
print run, after the customer had paid.

The upload never touches the API: the browser PUTs to a signed Supabase URL, so
there are no bytes to inspect on the way in. And `DesignAsset.width`/`height` are
whatever the browser posted, unverified.

## Decision

**One pure definition, applied twice.**

`backgroundArtworkVerdict` in `shared-types` is the whole rule: within the
card's shape (`cropVerdict`), at least 200 dpi across the card
(`printDpiVerdict`), and inside the engine's decode ceiling. It **reuses the
existing thresholds rather than inventing its own**, so the gate is exactly as
strict as the warnings it replaces — a gate that drifted from the pre-flight
would refuse artwork while the editor said it was fine.

Applied:

1. **In the browser, before a byte is uploaded** — both places a member can set
   a background: "Upload your own artwork" on `/designs`, and Background → Image
   in the editor. This is where a customer wants to hear it, with the file still
   on their machine and nothing to undo.
2. **At the save, server-side** — `ArtworkGateService`, called from
   `parseDocument`. The same choke point ADR 0171 chose for the reserved footer,
   and for the same reason: every route into a stored design passes through it,
   including the two that create orders straight through Prisma and never touch
   the checkout service. A stale tab, a forged request, or a future surface that
   forgets cannot get around it.

Three scoping decisions, each with a test:

- **Only a background new to the design is judged.** One already there was
  accepted once; refusing it on a later save would trap a customer in a design
  they can neither fix nor keep — unable even to correct a typo on the card.
- **Catalog artwork is skipped.** It is gated at the sync, where it is ours and
  someone can go and fix it. Until the re-export lands most of it would fail
  here, blocking a text edit on artwork that is not the customer's to change.
- **Fail open on infrastructure, closed on artwork.** Storage unreachable, host
  not ours, bytes not an image → the save proceeds with a log line. The
  pre-upload check has already had its say, and a storage blip must not stop
  every customer saving every design. A file that _is_ measured and _is_ wrong is
  refused. The browser half does the same: an unmeasurable file says nothing,
  which is why it uses its own `readFileNaturalSize` rather than the editor's
  `readImageSize` — that one falls back to a square, which a shape rule would
  then refuse.

Every refusal names **the same fix**: export at `idealArtworkPixels`. One size
satisfies all three rules, which is what makes refusing reasonable rather than
merely obstructive.

## Consequences

- The gate measures with `orientedPixelSize` (ADR 0247), which is why that landed
  first. Measuring the stored size would refuse a correctly-shaped phone photo as
  heavily cropped — a customer doing exactly what we asked, told no. There is a
  test for precisely that.
- The gate fetches only from our own storage host. A design document carries
  customer-supplied URLs, so an unrestricted server-side fetch would be the same
  confused-deputy SSRF the print engine is allowlisted against (ADR 0162).
- `parseDocument` is async now, and `update` reads the stored document before
  writing so the gate can tell a new background from an existing one.
- The e2e fixtures reference `cdn.example.com` backgrounds, which are not our
  storage and so go unmeasured — they pass unchanged, which is the fail-open
  policy working rather than a gap.
- Ten guards mutation-tested across the three surfaces, including failing the
  gate closed instead of open, and dropping the host allowlist.

## What this does not do

Elements are still only warned about, not refused (plan D7): a small logo is a
legitimate element and never loses its edges, only its proportions, and blocking
would refuse a customer who stretched something deliberately. Vector artwork is
untouched here — the 1024px raster ceiling is a real issue and belongs with the
colour and resolution work, not with a shape rule.
