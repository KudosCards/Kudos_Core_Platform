# 0177 — One word for a group of contacts: "Lists"

## Status

Accepted — implemented. From a customer-experience review of the subscriber CRM.

## Context

The app had two things called a list, and only one of them was finished.

|                    | **Hand-picked** (`RecipientList`)                                               | **Smart** (`Segment`)                        |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------- |
| What it is         | People you choose                                                               | A rule that re-resolves live                 |
| Nav entry          | **none**                                                                        | `/segments`                                  |
| Where you make one | A `＋ New list…` option inside the Contacts _filter_ dropdown → `window.prompt` | "Save as list" on a preset → `window.prompt` |
| Where you see it   | An `<option>` in a `<select>`                                                   | A card with a count and a preview            |
| Send to it         | Filter the picker, tick every member, twenty to a page                          | One click                                    |
| Rename             | Only while filtered to it                                                       | **No endpoint existed**                      |
| Change the rule    | n/a                                                                             | **Impossible** — delete and start again      |
| Remove one person  | **Impossible in the UI**                                                        | n/a                                          |
| Delete             | `window.confirm`                                                                | No confirmation at all                       |

The thing a customer builds by hand — the Year 4 class, the team, the people
they actually care about — was the harder of the two to use in every respect.

Three capabilities existed on the server and were never called:

- `GET /recipient-lists/:id` returned a list **with its members**. Nothing in
  the web app fetched it. The one screen that would show you who is on a list
  did not exist.
- `DELETE /recipient-lists/:id/members/:recipientId` took one person off a
  list. Nothing called it: once someone was on a list, the only way off was to
  delete the whole list.
- `POST /segments` accepted a full `SegmentDefinition` — any mix of eight
  occasion types across three kinds of date window, or contact filters on
  source, status, postal address and membership of another list. The UI could
  only ever post one of five presets' definitions back verbatim. "Save as list"
  therefore produced a card that behaved identically to the suggestion directly
  above it, so the action appeared to do nothing.

Two smaller findings on the way:

- `contact.hasMailableAddress: true` was accepted by the schema and then
  **ignored by the resolver**, so a rule asking for "only people we can post
  to" quietly returned everyone, missing addresses included.
- The "Missing an address" suggestion's primary action was **Send to this
  list** — for the one group where a send is blocked for every card.

## Decision

**One word.** A list is a group of contacts you send to in one go. It is either
**picked by hand** or it **updates itself**. That is the only difference the
customer needs to hold, and it is a badge on an otherwise identical card.

### The shape

- `/lists` replaces `/segments` (which redirects). Both kinds in one grid, same
  card, same count, same preview, same primary action, filterable by kind.
  Suggestions appear below as a savable strip, and drop off it once the same
  rule is saved.
- `/lists/[id]` — a hand-picked list's own page: who is on it, searchable and
  paginated, with rename, bulk removal, "Add contacts" and one-click send.
- `/lists/smart/[key]` — a smart list's page: the rule in plain English, who it
  matches now, rename, edit-the-rule, delete. A suggested preset has no stored
  row, so it is read-only with an offer to save a copy.
- `/lists/smart/new` — the rule builder.

**Members are read through `GET /recipients?listId=`**, not from the list route.
That endpoint is already paginated and already carries the search, sort, status
and missing-address filters the contacts table uses, so a list's people are
browsed with the same tools as everyone else's rather than through a second,
weaker view. The list routes carry a bounded eight-member preview and the true
count — the old detail route loaded every membership row with its recipient
joined, which is fine for a Year 4 class and a table scan for an account that
imported five thousand contacts into one list.

### New API

- `PATCH /segments/:id` — rename, change the rule, or both. Both fields
  optional, at least one required, so a rename cannot silently overwrite the
  rule with a stale copy the client was holding.
- `POST /segments/preview` — resolve an unsaved rule. The builder's count is the
  server's real answer for the rule as it stands, not a promise the save has to
  make good on.
- `DELETE /recipient-lists/:id/members` — bulk removal. Deliberately does not
  404 on someone already off the list: the caller ticked rows on a view that may
  have moved on, and the outcome it asked for is true either way.
- `GET /segments/members?list=` — seeds the composer from a hand-picked list, by
  resolving it as a contact-mode rule scoped to that list. One cap, one `capped`
  flag, one heading; the two kinds cannot drift apart.

### No more `window.prompt`

Four customer-facing prompts become the shared `NameDialog`. The browser dialog
is unthemed, is a system sheet on mobile, cannot say what the name is for, and
has nowhere to put an error — a duplicate name arrived as a banner at the top of
the page, after the dialog had closed and the typed name was gone. The new one
keeps what you typed and shows the reason against the field. `ConfirmDialog`
does the same for deletion, and says what survives: deleting a list never
deletes the people on it.

### Two corrections shipped with it

`hasMailableAddress: true` is now honoured. And a list defined as people with no
postal address leads with **Add their addresses →** rather than a send that
would be blocked for every card on it.

## Consequences

- Every list has a page, a count, a preview, rename, delete and one-click send,
  whichever kind it is. The hand-picked list is no longer the poor relation.
- The builder exposes what the API always accepted, including
  `contact.listId` — so the two kinds compose: "active contacts on Year 4 class,
  with a postal address" is a rule you can now write.
- Contacts keeps list _filtering_ and gains a real add-to-list flow with a
  confirmation that names the list and links to it. Creating, renaming and
  deleting move to where lists live. Arriving from a list's "Add contacts"
  carries `?addToList=`, so filling a list is a round trip rather than a dead
  end.
- `RecipientListWithMembers` is gone from shared-types; every list route returns
  `RecipientListSummary` (now with `sample`). No consumer used the old shape.
- Segments recorded no audit entries at all while lists audited everything.
  Create, update and delete now match.
- The URL `/recipients` still holds the contacts route (ADR 0144's label ≠
  identifier split), and the domain vocabulary stays `Recipient`/`Segment` in
  code. This ADR is about the words a customer reads.

Supersedes the UI half of ADR 0105 (segments as their own page) and completes
the list half of ADR 0016. ADR 0106's `?segment=` seeding is unchanged and now
has a `?list=` sibling.
