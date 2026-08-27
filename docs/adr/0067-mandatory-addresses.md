# 0067 — Mailable addresses: capture, autocomplete, and "needs address" flagging

## Status

Accepted — **amended** (see "Amendment: address optional on manual add/edit" below).

## Context

Kudos posts physical cards via Royal Mail, so a contact without a full postal
address can't be sent one. Yet contacts were arriving unmailable in bulk:

- the **CSV import only captured a postcode** — not address line 1 or city — so
  every imported contact was unmailable by construction;
- the **direct Add-Contact form asked only for a postcode**;
- **CRM syncs** carry whatever the source has, which often has no address.

User feedback: "too many contacts are being added without address information."
The goal is to make adding a mailable contact the easy, default path while never
silently dropping a bulk source.

## Decision

**Import-and-flag, not hard-block** (the owner's call). A contact can always be
saved/imported; anything unmailable is surfaced everywhere so it can be
completed before a card is sent — rather than rejecting bulk sources that can't
guarantee an address.

**One definition of "mailable"**: address line 1 **and** city **and** postcode,
all non-blank. Encoded once as `MISSING_ADDRESS_WHERE` in `recipients.service.ts`
and reused by the list filter, the dashboard count, and (via `isMailable`) the
web badge, so server and client never disagree.

**Capture the full address, everywhere it's entered:**

- CSV import now parses `addressLine1`, `addressLine2`, `addressCity` alongside
  `postcode` (still permissive — a row without them imports and is flagged). The
  sample template + column hints were updated.
- The direct Add-Contact form now collects the full address and marks line 1,
  city, and postcode **required** at the form level (`AddressFields`).

**Free postcode autocomplete** via a provider-agnostic `lib/address-lookup.ts`.
The default implementation is **postcodes.io** — free, no API key, CORS-enabled —
which validates a postcode and auto-fills the town from open data. House-level
"pick your exact address" needs Royal Mail PAF data (licensed, keyed/paid), so
the lookup is written behind a stable return shape: dropping in a keyed provider
later adds a "select address" step with no other change.

**Surface the gap so it gets chased:**

- a per-row "⚠️ Needs address" badge and a "Needs address" filter on the
  recipients list (`?missingAddress=true`, backed by the list filter);
- a "N contacts need an address" nudge on the dashboard
  (`DashboardSummary.contactsMissingAddress`) linking to the filtered worklist.

**Enforcement layer.** Mandatory address is enforced at the **web form** for now;
the create DTO stays permissive so bulk/programmatic callers and the
import-and-flag path aren't rejected. Promoting it to a hard API requirement
(with the corresponding e2e-fixture updates) is a clean follow-up — deliberately
kept out of this change so it doesn't bundle a broad test-churn into the
address-capture work.

## Consequences

- Imported and manually-added contacts can now carry a real mailable address;
  the ones that don't are visible and actionable rather than invisible.
- Adding an address is faster and less error-prone (postcode validated, town
  filled) at zero cost and with no API key.
- Clear upgrade path to house-level autocomplete when a keyed provider is added.
- Follow-ups: adopt `AddressFields` + the lookup in the checkout / bulk-send /
  guest flows; per-row CSV validation preview.

## Amendment: address optional on manual add/edit

The original decision hard-required an address on the manual-add path (both the
web form and, later, the `CreateRecipientDto`). Owner feedback reversed this: a
contact should be **saveable with just a name**, address added later — because
the system already **hard-stops sending** to an addressless contact
(`bulkSend`/`quickSend` throw a `BadRequestException`, and the composer filters
them out), so send time is the right and only place to enforce mailability.

Changes:

- `CreateRecipientDto` address fields (line 1, city, postcode) are now
  **optional**; a postcode, if given, must still be a valid UK one. A new
  `BlankToNull()` transform maps blank submissions to `null` so a manual **edit**
  can also _clear_ an address, not just add one. The manual-add path now matches
  the import-and-flag behaviour of CSV/CRM.
- Web: the Add-Contact form's `AddressFields` is `required={false}` with a note
  that the address can be added later; the recipient-edit form always sends the
  address fields so one can be cleared.

Everything else from the original decision stands: the single "mailable"
definition, the "needs address" badge / list filter / dashboard nudge, and the
send-time enforcement — which is now the sole gate. This supersedes the earlier
"promote the DTO to hard-require address" follow-up.
