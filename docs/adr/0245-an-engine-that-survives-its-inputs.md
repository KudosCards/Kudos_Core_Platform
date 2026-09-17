# 0245 — An engine that survives its inputs

## Status

Accepted

## Context

The card→PDF engine takes bytes a customer uploaded and hands them to pdfkit.
Three things about that were wrong, and the plan to retire the browser print
path (docs/card-print-quality-plan.md, D11) makes this engine the only route to
a printed card — so they had to be fixed before anything else was built on it.

**A corrupt PNG killed the process.** Reproduced rather than reasoned about: a
PNG with a valid IHDR and a damaged IDAT passes `sharp().metadata()` (a header
read), `doc.image()` returns _without throwing_, no `error` event fires on the
document, and the process then exits on an uncaught `invalid bit length repeat`.
pdfkit inflates the pixel stream with
`zlib.inflate(data, (err) => { if (err) throw err })` — a throw inside an async
callback, which is outside `decodeImage`'s `try`/`catch`, outside the resolver's
`.catch`, and outside the `renderRunPdf` promise chain. Nothing on the path can
see it. One truncated upload took down every in-flight request; no malice
required.

**Nothing bounded pixels.** Every limit was a _byte_ limit — the bucket's 10 MB
and the loader's 25 MB. A hand-built 74-byte PNG declaring 16000 × 16000 RGBA
passes both, and drives pdfkit's synchronous PNG path into roughly 2 GiB of
`Buffer.alloc` plus a `deflateSync` on 0.75 GiB. No `limitInputPixels` was set on
any `sharp()` call in the API, so the only ceiling was sharp's own 268-megapixel
default — above the bomb.

**Every page re-embedded the artwork.** pdfkit de-duplicates an image only when
`src` is a string (`_imageRegistry`, guarded by `typeof src === 'string'`); the
engine passes Buffers, so each draw wrote another full copy into the file.
Measured at **30.9× on fifty pages** of one background. The resolver's cache hid
it by de-duplicating the fetch rather than the embed.

## Decision

1. **Only JPEG is passed through.** pdfkit embeds the DCT stream without
   decoding it, so malformed JPEG bytes become a bad image in a viewer and never
   our problem — and re-encoding would discard detail for nothing. **Everything
   else is re-encoded through `sharp`**, which is what makes the bytes
   _known-decodable_ before pdfkit's decoder sees them. The corrupt PNG now fails
   as `vipspng: libpng read error`, caught, and the asset is skipped like any
   other unreadable one.

2. **Two pixel limits, because they answer different questions.**
   `MAX_ARTWORK_PIXELS` is derived — the largest card face at twice the target
   DPI — and is a **downscale** ceiling, not a refusal: a photographer's
   50-megapixel upload is a legitimate thing to send us, and the right answer is
   to print it at the size it will appear, not to drop it from the card.
   `MAX_DECODE_PIXELS` is a refusal, because downscaling requires decoding and an
   image big enough to exhaust memory during the decode cannot be rescued by a
   ceiling applied after it. Set above the largest consumer sensor so no real
   photograph is refused, and far below sharp's default.

3. **One image, one embed, per document.** `openImage` is called once per asset
   URL and the resulting object passed to every `doc.image()`, taking pdfkit's
   `if (src.width && src.height)` branch and reusing the single XObject.

4. **A crash reporter registered explicitly in `main.ts`.** Not left to Sentry:
   Sentry's own handler declines to exit when another listener is present, so a
   half-installed pair would leave the process running in the undefined state
   Node is clear you must not choose. This logs, reports, flushes and exits. The
   specific hole is closed at the decoder; the _shape_ of it is not unique to
   images, and a process that dies silently is worse than one that dies loudly.

## Consequences

- The three falsifying checks in the plan all pass: the corrupt PNG resolves to
  `null` and the run completes, the 16000 × 16000 declaration is refused before
  pdfkit sees it, and thirty pages of one background cost well under three copies
  of it rather than thirty.
- **An existing test asserted the opposite** — that PNG bytes were handed on as
  the same Buffer, "no re-encode". That was the defect written down as a
  contract, so it was changed rather than relaxed, with the reason in the test.
  A second test now pins the JPEG passthrough that _is_ still correct.
- Re-encoding costs one `sharp` pass per distinct asset per run, not per page,
  because the resolver already memoises. It is also the natural place for the
  sRGB normalisation the colour phase needs (P5), which pdfkit cannot do for us:
  it writes no ICC profile at all.
- Downscaling is the one behaviour here a customer could notice, and only above
  17.3 megapixels — beyond what the largest card can print at 600 dpi. It is
  logged.
- Every guard is mutation-tested: each was reverted in turn and a test failed
  each time, including the downscale being made to distort.
