# 0079 — Support: attachments + guided prompts + diagnostics

## Status

Accepted

## Context

The support form (ADR 0066) took a subject, category, and a single free-text
message. In practice that means a lot of "can you send a screenshot?" /
"which page were you on?" round-trips before support can even start — slow for
the customer and expensive for us. We want customers to be able to *show* the
problem and explain it clearly the first time.

## Decision

Three additions, all on the customer side of a ticket (raising it and replying),
built on the existing signed-upload → public-bucket storage model.

**1. Attachments (screenshots + screen recordings).** A new
`support-attachments` storage bucket (public-read, unguessable per-account path —
same model as `design-assets`/`message-videos`), accepting images and the three
web video formats, 50 MB each, up to 5 per message. `POST /uploads/support-
attachments` mints a signed upload; the client PUTs the bytes, then submits the
resulting file references with the message. A new `SupportTicketMessageAttachment`
row hangs off each message; the thread renders image thumbnails (click to open)
and inline video players on both the customer and ops views. Screen *recording*
is upload-a-file (record with a phone or a tool like Loom) rather than an in-app
recorder — simplest, works everywhere, ships now.

**2. Guided prompts.** The single message box becomes three fields — *What
happened?* (required), *What were you trying to do?* and *What did you expect?*
(both optional) — composed into one structured message body. Same API contract
(still a `message` string), better signal.

**3. Silent diagnostics.** At ticket creation the browser captures best-effort
technical context — the page they came from, user agent, viewport, app version —
stored on `SupportTicket.diagnostics` (JSON) and shown in an ops-only panel.
Never blocks submission (all fields optional, capture wrapped defensively), and
never shown to the customer.

Scope: attachments are **customer-side** for now (raising + replying); ops can
*view* them but sending an attachment back is a deliberate later follow-up — the
time saving is in the customer explaining better up front. All existing
validation, notification, and thread-state logic is untouched; attachments and
diagnostics are additive and every field is optional, so the plain
subject+message flow still works.

## Consequences

- Support gets the screenshot/recording + the page/browser context on the first
  message, cutting the diagnostic back-and-forth.
- New bucket is created + limit-enforced at boot by the existing
  `ensureBuckets()` path — no manual dashboard step.
- Attachments are public-read behind an unguessable URL, consistent with the
  other buckets (ADR 0006). Support evidence can contain account data; if that
  ever needs signed/expiring access, it's a bucket-policy change, not a schema
  one.
- Tests: shared attachment/diagnostics schemas; e2e (create with an attachment +
  diagnostics → customer sees the attachment, ops sees attachment + diagnostics;
  a reply carries its own attachment; a non-URL attachment location is a 400).
  Full support e2e green (11).
- Not done (deliberate): in-app screen recorder, ops-side attachments, and
  virus scanning on uploads — revisit if the need appears.
