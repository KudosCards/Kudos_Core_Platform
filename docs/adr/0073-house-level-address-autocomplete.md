# 0073 — House-level address autocomplete via Ideal Postcodes

## Status

Accepted

## Context

ADR 0067 shipped free postcode validation via **postcodes.io** — it confirms a
postcode is real and auto-fills the town, but can't return house-level addresses
("pick 12 High Street") because that needs Royal Mail **PAF** data, which is
licensed. The seam was written provider-agnostically so a keyed provider could
drop in later. The owner asked to wire one up.

Provider choice (see the session's cost discussion):

- **getAddress.io** — ruled out: it **shut down 4 Feb 2026** after a Royal Mail
  IP claim over its PAF usage.
- **Ideal Postcodes** — chosen: properly PAF-licensed (plus OS UPRN/geocodes),
  operating, **pay-as-you-go at ~2–2.5p per resolved lookup, no subscription**,
  and CORS-enabled for client-side use.

## Decision

**Extend `lib/address-lookup.ts`, don't replace it.** A new `lookupAddresses()`
calls Ideal Postcodes' `/v1/postcodes/{postcode}` and returns the full list of
addresses at a postcode (`line1`, `line2`, `town`, `postcode`, a display
`label`). It's gated on **`NEXT_PUBLIC_IDEAL_POSTCODES_API_KEY`**: unset →
returns `null` and the form uses the existing free postcodes.io town autofill;
set → the form offers "pick your exact address". PAF splits the street across
`line_1..line_3`, so `line_2`/`line_3` are joined into our single line 2.

**One "Find address" button, graceful degradation.** `AddressFields.findAddress`
tries the house-level lookup first; if it returns candidates, it shows a "Choose
your address" `<select>` that fills line 1 / line 2 / town / postcode on pick. If
there's no key (or the lookup fails/errors), it falls straight through to the
town-only confirmation — same UX as before. So every consumer of `AddressFields`
(the Recipients add form, onboarding, and any future shipping form via the
`namePrefix` seam) gains house-level autocomplete for free the moment the key is
set, with no per-form change.

**Client-side, browser key.** Ideal Postcodes issues restricted keys scoped to
allowed domains, so exposing it as a `NEXT_PUBLIC_` var is the intended usage;
autocomplete/lookup requests are free and only resolving a chosen address bills,
keeping cost proportional to real address entries.

## Consequences

- With the key set, adding a contact becomes "type postcode → pick address" —
  the lowest-friction, highest-accuracy path, directly serving the "no
  guesswork, best possible outcome" goal.
- Ships dark: nothing changes until `NEXT_PUBLIC_IDEAL_POSTCODES_API_KEY` is set
  (Railway/Netlify), and it degrades cleanly to the free lookup if the key is
  absent, rate-limited (429), or out of credit (402).
- Cost is pay-as-you-go (~2.5p/resolved address), so ~£25 per 1,000 contacts
  added via the picker; no monthly minimum.
- Follow-up: a typeahead (address search as you type, before a full postcode) is
  a further Ideal Postcodes feature we could add later; this change does the
  postcode → address-list step, which covers the common case.
