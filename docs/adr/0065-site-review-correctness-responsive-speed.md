# 0065 — Site review: correctness, responsive, and load-speed fixes

## Status

Accepted

## Context

A full-site review across three axes — common correctness errors, responsive
behaviour (mobile / tablet / desktop, including the card-editing flow), and page
load speed. The app had already been through dedicated passes on each (ADRs
0042, 0045; review tasks over several phases), so this pass looked for the
concrete issues those left behind rather than broad rework. Findings were
verified against the code, not guessed.

## Findings & fixes

### Correctness — editable lists keyed by array index

Two editable lists rendered rows with `key={index}` **and** removed rows by
index. React then reconciles by position, so deleting a middle row leaves the
rows below misaligned — a row's input value / focus jumps to its neighbour.

- **Recipient custom fields** (`recipient-detail-client.tsx`) — member-facing.
- **Seasonal dispatch windows** (`seasonal-dispatch-setup.tsx`) — ops admin.

Both now carry a stable client `id` and key / update / remove by it. The
seasonal rules keep the wire type unchanged (`SeasonalDispatchRule` has no id):
rows are held as `{ id, rule }` in state and the id is stripped before the API
call.

### Responsive — narrow-screen tightness on the Designs gallery

On the 2-column mobile grid, the saved-design tiles' three-button action row
(Edit / Rename / Delete) had no `flex-wrap`, so it could overflow the ~160 px
tile; long design/template names weren't truncated. Added `flex-wrap` to the
action row and `truncate` (+ `title`) to the names on both saved-design and
template tiles.

The rest of the responsive foundation was verified sound: no raw `<img>` (all
`next/image`), every wide table wrapped in `overflow-x-auto`, fixed widths are
`max-w-*` or inside scroll containers, the modal is a mobile bottom-sheet, and
the card editor scales its canvas to the container and wraps its panel.

### Load speed

- **Server-fetch waterfalls removed.** `orders/[id]` (order + wallet) and
  `recipients/[id]` (recipient + events + RTS cases) awaited their independent
  requests serially. Both now issue them in a single parallel `Promise.all`
  round-trip, preserving the 404 → `notFound()` semantics (the recipient/order
  404 becomes `null`; the sibling fetches are only wasted in that rare case).
  This follows the parallelisation pattern ADR 0042 applied elsewhere.
- **`qrcode` lazy-loaded.** `lib/qr.ts` statically imported the ~50 kB `qrcode`
  library, which pulled it into the Messages page's first-load bundle. Since
  `qrDataUrl` is already async, it now `await import("qrcode")` internally —
  the library is fetched on demand the first time a QR renders and is gone from
  every static bundle. (Konva was already isolated behind `dynamic(ssr:false)`.)

Verified already-good: `next/image` everywhere with `sizes` on every `fill`
image and `priority` on LCP images; Supabase image host whitelisted; Router
Cache `staleTimes` tuned; self-hosted `next/font`; per-request token dedup via
React `cache()`.

## Consequences

- Two real, user-visible list-editing bugs are gone.
- The Designs gallery holds up on the narrowest screens.
- The order- and recipient-detail pages render after one API round-trip instead
  of two/three; the Messages page ships less first-load JS.
- No API, schema, or data changes — all fixes are web-side.
