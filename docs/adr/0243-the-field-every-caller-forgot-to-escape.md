# 0243 — The field every caller forgot to escape

## Status

Accepted

## Context

Investigating a run of junk "New Enterprise enquiry" emails turned up something
unrelated to the spam: `renderBrandedEmail` interpolated `preheader` and
`heading` into the email shell as raw HTML.

Fourteen services call it. Every one of them wraps user-supplied values in
`escapeHtml` on the way into `bodyHtml`. Not one of them escaped the preheader.
That ratio is the finding. Fourteen careful callers making the same omission is
not fourteen mistakes; it is one badly-drawn contract, in which two adjacent
fields of the same interface had opposite escaping rules and nothing said so.

Five call sites pass user-controlled data into `preheader`. The sharpest is
`messages.service.ts`: `senderName` on `POST /messages/:slug/replies` is
anonymous, unauthenticated and capped at 80 characters, and the email it titles
goes to a paying customer. A working breakout payload fits in about 56.

Confirmed against the compiled function rather than reasoned about — a hostile
name closed the hidden preheader `<div>` and rendered a live, clickable link in
the visible body:

```
<div style="display:none;...">
    Anna</div><p ...><a href="https://evil.example/pay">Your invoice is overdue</a></p><div style="display:none"> at Acme...
```

Not browser XSS — mail clients strip scripts — but content injection into mail
that carries Kudos branding and Kudos's sending reputation, which is the useful
half of a phishing email. No evidence of exploitation.

## Decision

**The layout escapes every plain-text field it owns; `bodyHtml` stays the single
trusted-HTML field, and says so.**

1. `preheader`, `heading`, `footerNote` and `cta.label` are escaped inside
   `renderBrandedEmail`, and control characters are flattened to spaces (these
   are all single-line fields; a newline in one is never content, and a newline
   in something that later becomes a mail header is where header injection
   starts).

2. **No call site changed.** That the five vulnerable callers became safe without
   being touched is the point: a fix applied at five call sites leaves the trap
   armed for the sixth.

3. `cta.url` is escaped by `escapeUrlAttribute`, which **deliberately leaves `&`
   alone** while removing quotes and angle brackets. Encoding `&` to `&amp;` is
   the strictly-correct HTML and every mail client decodes it — but the URLs
   passing through here include password-reset and magic links whose query
   strings are the difference between a customer getting back into their account
   and not, and `&` is not an escape vector. Breaking out of the attribute needs
   a raw quote; opening a tag needs a raw angle bracket.

4. `bodyHtml`'s doc comment now names it as the one field callers must escape
   into, so the asymmetry is stated rather than implied.

## Consequences

- The public, unauthenticated paths that reach an email — Enterprise enquiries
  and message-page replies — can no longer put markup in a Kudos email.
- `apps/api/src/email/email-layout.spec.ts` pins all of it, including the exact
  recon payload. Every guard was mutation-tested: each escape was reverted in
  turn and a test failed each time. Two rounds were needed — the first pass
  missed the paste-this-link fallback, which is escaped separately from the
  button and so needs its own guard. The gap was in the tests, not the fix.
- Callers that were already correct are unaffected; escaping already-plain text
  is a no-op. `"Review & send"` now renders through an entity, as it should have.
- Future callers cannot reintroduce this by forgetting, because there is no
  longer anything to remember.
