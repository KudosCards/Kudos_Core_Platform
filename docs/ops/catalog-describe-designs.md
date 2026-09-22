# Describing the catalog

What to fill in, and why it matters. This rides along with the artwork
re-export (`docs/ops/catalog-re-export.md`) — doing both in one pass through the
catalog is the difference between one trip and two.

## What to add in Airtable

Two new columns on the Cards table. Single-select is easiest, but plain text
works — the sync matches case-insensitively and understands the obvious
synonyms.

### Age Band

Also accepted as a column name: `Age`, `Age Group`, `Suits`, `Audience`.

| Value   | Means                       | Also accepted                           |
| ------- | --------------------------- | --------------------------------------- |
| `Any`   | Suits anybody               | Any age, Anyone, All, All ages, General |
| `Child` | Specifically for a child    | Children, Kid, Kids, 0-12               |
| `Teen`  | Specifically for a teenager | Teens, Teenager, 13-17                  |
| `Adult` | Specifically for a grown-up | Adults, Grown up, 18+                   |

**Most of the catalog should be `Any`.** The useful fact is "this one is
specifically for a child", not an age for every card. If you hesitate, it is
`Any`.

**Leaving it blank is not the same as `Any`.** Blank means nobody has looked at
this card yet, and the sync counts it as outstanding work. `Any` means you
looked and decided it suits everybody. Please do not leave a card blank to mean
"anyone".

### Tone

Also accepted as a column name: `Style`, `Mood`, `Feel`.

| Value     | Means                      | Also accepted                        |
| --------- | -------------------------- | ------------------------------------ |
| `Funny`   | Jokes, cartoons, puns      | Humour, Humor, Humorous, Comic, Joke |
| `Warm`    | Heartfelt, affectionate    | Heartfelt, Sincere, Sentimental      |
| `Elegant` | Classic, ornate, formal    | Classic, Formal, Luxury, Ornate      |
| `Simple`  | Clean, typographic, modern | Minimal, Clean, Plain, Modern        |

## How to tell it worked

Run a catalog sync from the ops page. The result now carries an `attributes`
section:

- **`undescribed` / `total`** — how many active cards still have no age band.
  This is the progress bar. It has to reach zero.
- **`unknownValues`** — anything typed that we could not place, named with the
  card it was on.

That second list is the one to check. A word we do not recognise is stored as
**blank**, exactly like an empty cell — so a card reading "Middle-aged" looks
finished and is not. If a card appears there, change it to one of the values
above and re-sync.

## Why this is worth the afternoon

Automatic sending currently picks a card from the customer's chosen set by
hashing the recipient — deterministic and fairly spread, but it knows nothing
about the person. It cannot do better while every design in the catalog is
silent about who it suits. This is the pass that changes that.
