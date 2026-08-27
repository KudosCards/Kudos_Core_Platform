# 0097 — Recipients page redesign: contact list first

## Status

Accepted

## Context

The recipients page is the app's CRM-style contacts screen, but its layout buried
the actual contacts: a large "Add a recipient" form card and an "Import from CSV"
card sat side-by-side at the top, followed by a CRM callout and a full "Lists"
management card — so on a normal screen the contact table started halfway down,
out of sight. For a page whose primary job is _browsing and acting on contacts_,
the list should be the focus, not the data-entry widgets.

## Decision

Rebuild the page around the contact list, relocating the entry widgets into
header actions and dialogs (matching the agreed new design).

1. **Header actions + dialogs.** The title/subtitle sit left; the right carries
   `Sync a CRM` (link), `Import CSV`, and `Add recipient`. The add form and the
   CSV import now open in the shared `Modal` (a mobile bottom-sheet), so they're
   one click away but never crowd the list. The standalone Lists card and CRM
   callout are gone — list selection folds into a filter dropdown, and the CRM
   nudge lives in the header link + a footer entry point.

2. **Missing-address banner.** A prominent worklist nudge — "N recipients can't
   be posted to. {names} {is/are} missing an address." with a **Show these N**
   button that filters to them — replaces the old inline "Needs address" toggle.
   Fed by an unfiltered `missingAddress=true` fetch so it's accurate regardless
   of the table's current page/filters.

3. **A denser, more useful table.** Columns are now **Name & address** (name +
   the one-line address, or a "Needs an address" prompt), **Date of birth**,
   **Next birthday** (a computed year-agnostic countdown, e.g. "23 Oct · In 80
   days"), **Postcode**, **Source**, **Actions**. An **Active / Archived**
   segmented control carries live unfiltered counts; filters are search + list +
   birthday-month + **source**.

4. **A real bulk bar + footer.** Selecting rows reveals a dark action bar:
   Add-to-list (with a "＋ New list…" escape hatch), **Export** (selected → CSV),
   Archive/Restore, and "Send a card to N →". A footer shows the visible count
   plus low-emphasis "Download a sample CSV" / "Connect Brevo, HubSpot or Zapier"
   links.

5. **API: a `source` filter.** `GET /recipients` gains an optional `source`
   query param (mirrors the existing `status`/`birthMonth` filters) so the
   "Any source" dropdown filters server-side, consistent with the rest.

Every existing capability is preserved — add, CSV import, list create/rename/
delete/add-to, search, sort, birthday-month filter, archive/restore, the
`?missingAddress=true` dashboard nudge, and the mobile stacked-card layout — just
relocated so the list leads.

## Consequences

- The contact list is immediately visible and is the page's clear focus; adding
  or importing is a deliberate action, not a permanent fixture stealing the fold.
- The Next-birthday countdown and one-line address make the list scannable for
  its real jobs (who's coming up, who can't be posted to) without opening a row.
- One small additive API change (`source` filter); no schema/migration. The
  redesign is otherwise web-only.
- Trade-off: tab counts + the missing-address worklist are fetched separately
  from the (filtered) table — three small parallel requests on mount — so the
  header count, tabs, and banner stay accurate independently of the table's
  filter/pagination state.
