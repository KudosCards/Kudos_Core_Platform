# 0071 — Mailable address required at the API for manual adds

## Status

Accepted (promotes the follow-up flagged in ADR 0067)

## Context

ADR 0067 shipped "import and flag": a contact could always be saved, and
anything unmailable was surfaced via the "needs address" flag/worklist. Address
was enforced only at the web Add-Contact **form**; the `POST /recipients` DTO
stayed permissive, and it was noted that promoting it to a hard API requirement
was a clean follow-up. The owner asked to do exactly that — **require address on
manual adds** — while keeping bulk sources import-and-flag.

The key question was what "manual add" covers. `POST /recipients` is hit by two
web forms only: the Recipients "Add contact" form (already required address) and
the **onboarding quick-add** (name-only, for a fast first run). Every bulk path —
CSV import (`POST /recipients/import`), and CRM/inbound via `ingestContacts` —
goes through different code that does **not** touch this DTO. So hardening the
DTO affects manual adds alone; import-and-flag is untouched.

## Decision

**`CreateRecipientDto` now hard-requires `addressLine1`, `addressCity`, and a
valid `addressPostcode`** (line 2 stays optional). A manually-added contact is
therefore always mailable — the API enforces it, not just the form.

**Onboarding quick-add now collects the address too.** Both manual-add forms in
`/get-started` embed `<AddressFields>` (with the free postcodes.io "Find
address" lookup) and validate line 1 / town / postcode before submitting, so the
onboarding path stays in step with the API. This adds a little first-run
friction on the manual path — the owner's explicit trade for guaranteeing
mailable contacts — while the onboarding **hero remains bulk CSV import**, which
stays import-and-flag.

**Bulk stays import-and-flag.** CSV import and CRM/inbound `ingestContacts` are
unchanged and still create-and-flag unmailable contacts; the "needs address"
worklist remains how those get chased.

**`AddressFields` gained a `namePrefix`** ("address" default, or
"shippingAddress") so the same block — including postcode lookup — can later drop
into the shipping-address forms.

## Consequences

- Every manually-added contact is mailable by construction; the API is the
  backstop, so a programmatic manual `POST` can't create an unmailable contact
  either.
- The e2e suite was updated to match: fixtures that create a contact for
  downstream assertions now send a full address (a shared `MAILABLE` constant),
  and the handful of tests that specifically need an **unmailable** contact
  create it straight through Prisma — mirroring the permissive import paths.
  A new test asserts `POST /recipients` without a full address is a 400. Full
  suite green (269).
- Follow-up (deliberately deferred): adopt `AddressFields` visually in the
  **checkout** (controlled per-line shipping address) and **guest** (public
  slate-themed) flows — each needs a small theme/controlled-model adaptation
  rather than a clean drop-in, so they're their own change. The `namePrefix`
  groundwork is in place.
