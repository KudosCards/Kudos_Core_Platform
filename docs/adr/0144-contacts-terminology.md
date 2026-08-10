# 0144 — One word for the people you send to: "Contacts" (not "Recipients")

## Status

Accepted — implemented. From early customer feedback (Wave 2).

## Context

A customer flagged that the app mixes two words for the same thing — the people
you send cards to were called **"Recipients"** in the sidebar, the list page, and
various labels, but **"Contacts"** in the CSV import, the get-started wizard, the
landing page, and the admin. Two names for one concept is a small but real
confusion tax, and it read as an unfinished product.

The user chose a single word: **Contacts** (the consumer-familiar term — phones
and CRMs call them contacts).

## Decision

Standardise the **user-facing** vocabulary on **"Contacts"** across the member
app, while leaving the code's domain vocabulary (`Recipient`) untouched.

### What changed (display text only)

- Sidebar nav label, the Contacts list page (heading, buttons, filters, empty
  states, bulk-action copy, error toasts, export filename), the contact detail
  page (back-link, helpers, errors), the dashboard stat + "Send a card" quick
  action, the calendar strap, the send flow (personalisation heading/helper,
  pre-send check copy, the downloadable proof sheet's column header), batch-order
  copy, settings reminder copy, the integrations "Contacts page" reference, the
  message-page builder, and the return-recovery panels (in-app + public RTS).

### What deliberately did **not** change

- **Code identifiers.** The Prisma model stays `Recipient`; the API routes stay
  `/recipients`, `/recipient-lists`; types (`Recipient`, `RecipientListSummary`),
  props, variables, and query params (`?recipients=`) are unchanged. This is a
  **label ≠ identifier** split: renaming the schema/API would be a large, risky
  change (migrations, every consumer, the public inbound API and integrations)
  for zero user-visible benefit. The URL slug `/recipients` also stays, so no
  bookmarks or emailed deep links break — the visible nav label is what users
  read, and that now says "Contacts".
- **Public marketing prose.** On the pre-login landing and public card pages, a
  couple of sentences use "recipient" as plain English ("a card arrives through
  the recipient's door", "personalised with each recipient's name"). These read
  naturally, a logged-out visitor has no "contacts" yet, and the landing copy is
  getting its own dedicated rewrite (the "reads as AI-written" feedback) where
  this can be revisited holistically. A logged-in user never sees app chrome and
  marketing prose side by side, so there's no perceived mixing.
- **Ops / admin surfaces.** The internal `(ops)` area is staff-facing, not the
  customer, and already standardised its own "Customers / Contacts" language
  (ADR 0041). Out of scope for this customer-facing pass.

## Consequences

- The member app now says **Contacts** everywhere a customer looks — the
  confusion the feedback named is gone, with no schema change, no migration, and
  no broken links.
- The one intentional seam is code-vs-copy: engineers still read `Recipient` in
  the codebase while users read "Contacts". This is a deliberate, common split
  (the domain model keeps its precise term; the UI speaks the customer's), noted
  here so the divergence is understood rather than "fixed" later by accident.
- If we ever want the URL to read `/contacts` too, that's a self-contained
  follow-up (rename route + a redirect from `/recipients`), not required for the
  terminology to land.
