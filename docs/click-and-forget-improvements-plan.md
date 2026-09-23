# Click and forget — the second pass

The feature is built and merged, C1 to C8 (ADRs 0254–0261). This is the pass
over the page a subscriber actually uses, after looking at it with fresh eyes.

The goal has not changed and is worth restating, because every decision below
is judged against it: **set it up once and stop thinking about it.** Anything
on this page that makes somebody think is a defect unless it is a promise they
need to have read.

---

## What is wrong with it today

Three problems were reported, and three more turned up while reading the code
behind them. They are not equally serious.

### Reported

1. **It looks like a form, not a decision.** Six identical white cards stacked
   in a column, every one the same weight. A two-option radio ("who gets a
   card") is given exactly as much room as the consent statement somebody is
   legally relying on. There is no shape to it and nothing to look at.
2. **You cannot add a card without leaving.** The pool offers whatever is
   already in the design library and nothing else. A subscriber who wants a
   seventh card has to go to `/designs`, make it, come back, and re-choose.
3. **The message box is a bare textarea.** It asks you to type `{firstName}`
   from memory, and to write every message yourself with no help.

### Found while reading

4. **The pool accepts cards that are not birthday cards.** _(Fixed, ADR 0262.)_ `checkDesigns`
   (`standing-orders.service.ts:294`) validates that a design exists and is not
   archived. Nothing else. The live account's pool currently contains "Best of
   Luck Clover", "Best of Luck Clover copy" and "17th Milestone flowers copy",
   in an instruction that only ever sends **birthdays**. Somebody's birthday
   can arrive as a good-luck card, silently, every year. Every saved design
   knows where it came from (`SavedDesign.cardDesignId` → `CardDesign.category`),
   so this is visible to us and we simply never look.
5. **The page never says what it will do.** "Everybody — every contact with a
   birthday on record" does not say that this is 26 people, or that 8 of them
   have no postal address and will produce a skip notice rather than a card.
   `RecipientsService.readinessFor` already computes precisely this quartet —
   total, with a birthday, with an address, sendable — for CRM imports.
6. **The money and the birthdays are never shown together.** The consent
   statement says cards are paid from the wallet and that we will tell you when
   the balance will not cover one. The page then shows no balance, no
   projection, and no way to switch on the automatic top-up that exists to
   prevent exactly that. C2's projection ("covers the next 6 of 9; Grace's on
   the 14th is the first it will not reach") is computed daily, emailed, and
   has **no HTTP route** — the page cannot ask for it.

### And one that was not on either list

7. **`takesMessage` answered "no" for every design ever made.** Found while
   moving that rule so the page could ask it too. It probes the real placement
   with a sentinel string and searches the result for it — but the sentinel was
   built from NUL characters and the search ran over `JSON.stringify` output,
   which escapes them, so the needle and the haystack were never written the
   same way. Every subscriber was told that none of their cards would use the
   messages they had just written, while the send path printed them correctly.
   Fixed, and pinned at three levels; nothing had ever read the field in a test,
   which is how it shipped.

---

## What already exists, and will be reused rather than reinvented

| Need                                         | What it is                                                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a card without leaving the page          | `TemplatePickerModal` — already solves this on bulk send: renders the catalog, hands back a pick, the caller creates the saved design and routes into the editor with a `returnTo` |
| A picture of a saved design                  | `CardFacePreview` renders a design document at a measured width; `/designs` uses it for exactly this                                                                               |
| Insert `{firstName}` at the caret            | `MERGE_FIELDS` in shared-types, and the editor's caret-preserving `insertMergeField`                                                                                               |
| Keep the wallet funded                       | `AutoTopUpCard` — self-contained, takes `settings` and `onSaved`, currently in the wallet route folder                                                                             |
| Who the audience really covers               | `RecipientsService.readinessFor` — one definition of "postable", shared with the contacts page and the dashboard (ADR 0067)                                                        |
| Money against committed cards                | `WalletWatchService.project` — already the source of the daily warning (ADR 0255)                                                                                                  |
| An outbound call with a deadline and a retry | `common/http-request.ts` — timeout per attempt, retry only on 429/5xx, honours `Retry-After`                                                                                       |

Two assumptions worth correcting before anybody acts on them: `{Firstname}`
already works, because token matching lower-cases the inner name
(`merge.ts:151`), and a merge token inside a standing-order message genuinely
does resolve, because `print-run-pdf.service.ts:146` merges the snapshot at
print time. The page's promise is real today.

---

## Phases

Ordered so that nothing waits on anything it does not have to. D6 is last only
because it has an external dependency; it is not less important.

### D1 — Three steps, not six cards — **built (ADR 0262)**

Reorganise into: **Who gets a card** → **What we send** → **How it is paid, and
the switch**. A numbered step shell already exists on `/get-started` and should
be shared rather than copied. The status ("Running" / "Switched on but not
running" / "Off") moves into a header that stays put, and Save becomes a sticky
bar rather than a button below the fold of a long page.

The test that matters here is not a snapshot: it is that a subscriber can tell,
without scrolling, whether cards are going out.

### D2 — Cards you can see — **built (ADR 0262)**

Replace the text chips with a thumbnail grid built on `CardFacePreview`. "Best
of Luck Clover" and "Best of Luck Clover copy" are indistinguishable as words
and obvious as pictures. The page already fetches whole `SavedDesign` objects
server-side and discards the documents; it stops discarding them.

**Add cards** opens `TemplatePickerModal`, creates the design through
`POST /saved-designs`, and adds it to the pool in place. Editing one hands off
to the design editor and comes back — which needs the editor's `returnTo`
allowlist widened, since it is currently hard-limited to paths starting `/send`
(`design-editor-client.tsx:246`). That guard exists to stop an open redirect, so
widening it gets a test of its own.

### D3 — A birthday pool that knows it is one — **built (ADR 0262)**

Warn, by name, when a chosen design is not a birthday card: _"Best of Luck
Clover is a good-luck card. It will be sent for birthdays."_

Warned and not blocked, deliberately — the same rule C5 settled on. There may be
a reason to send a clover; there is no reason to do it by accident. The category
comes from the catalog row behind the saved design, so a design uploaded as
custom artwork has no category and is never warned about, which is correct:
silence is not a claim.

### D4 — Say what it will do, before it does it

Under the audience, the facts: **26 contacts · 24 with a birthday · 22 with an
address**. Computed by reusing `readinessFor`'s definition rather than counting
again, so this cannot disagree with the contacts page. Scope it by audience
(everybody, or one list) instead of by ingest source.

This is the sentence that turns "set it up once" into something a person can
believe, and it is also the moment to say that the two contacts without an
address will produce a notice rather than a card.

### D5 — The money, at the point the promise is made

Directly beneath the consent statement, not on another page:

- the wallet balance;
- the projection — _"covers the next 6 of 9 cards"_ — behind a new
  `GET /wallet/projection` that calls the existing service. One definition, two
  readers: the daily email and this page.
- the automatic top-up controls, by moving `AutoTopUpCard` into `components/`
  and rendering it here as well as on `/wallet`.

A link to settings was the other option. Embedding wins because the sentence
that creates the worry ("if your balance will not cover a card, we tell you
rather than send it") is the exact moment to offer the fix; a link is a second
page and a lost thought.

### D6 — The messages block — **built (ADR 0263)**

Two things, independent of each other.

**Insert the name.** A control on each message that inserts `{firstName}` at
the caret, sharing `MERGE_FIELDS` with the design editor so the two never offer
different tokens.

**Draft with a model.** A "Suggest messages" button that calls Anthropic's API
and returns a handful of drafts the subscriber can keep, edit or throw away.
Kept drafts are stored with `source: "assisted"`, which the schema has carried
since C4 and nothing has ever written.

How it is built:

- **A plain `fetch` to `https://api.anthropic.com/v1/messages` through
  `httpRequest`**, not the SDK. Zero new dependencies, and it inherits the
  repo's deadline, its retry rules and its `Retry-After` handling. The SDK
  brings its own and would be a second set.
- **No contact data in the prompt, ever.** Not a name, not a birthday, not a
  count. A draft is a template with `{firstName}` in it — the name is filled in
  at print time by the merge engine, weeks later. What goes up is the account's
  own name and a short brief the subscriber types ("tuition centre, warm but
  not soppy"). This is what makes the data-protection question small, and it is
  a property of the design rather than a promise in a comment: the request body
  is assembled from two named fields, and a test asserts no contact data can
  reach it.
- **Off until it is configured.** `ANTHROPIC_API_KEY` unset means the button
  does not render — the convention the env schema already uses for optional
  integrations. So D1–D5 ship whether or not the key and the agreement are in
  place, and the button appears the day they are.
- **Bounded.** A per-account daily cap counted from `AuditLogEntry`
  (`@@index([accountId, createdAt])` already exists, so no new table), a
  `@Throttle` on the route, a low `max_tokens`, and a pinned model id in a
  constant rather than a hand-typed string (ADR 0164). `claude-haiku-4-5` is the
  right default for six short messages; the id is overridable by env so a change
  of mind is a deploy, not a release.
- **Output is untrusted.** Validate every draft against the same schema a typed
  message must satisfy — length, trimmed, non-empty — and drop anything that
  fails rather than showing it. Nothing is saved until the subscriber saves it.
- **A failure says so.** A refusal, a timeout or a bad response tells the
  subscriber plainly and leaves their typed messages untouched; a failure
  nobody can explain raises an ops alert, the way the wallet's do.

**Shipped.** The key is on the API service. The data-processing agreement
review is still outstanding and is not a code question — the feature is live
behind the key, so it can be switched off by clearing the variable if that
review says to.

### D7 — Verification and the record

Unit tests for every new claim on the page, an e2e for the projection route and
the drafting route (with the upstream mocked), mutation-testing each guard as in
every phase so far, and an ADR recording the decisions — particularly the model
one, which is the first time this codebase has called one.

---

## What this deliberately does not do

- **Draft a message per contact.** Personalising the words to the person needs
  data about the person in the prompt, which is the thing that keeps this
  simple by not happening.
- **Choose the cards for you.** Still waiting on the catalog description pass
  (`docs/ops/catalog-describe-designs.md`). Until that is done a card is varied,
  not matched, and the copy says so.
- **Turn anything on by itself.** Standing permission to spend is given, not
  inferred, and none of this changes that.
