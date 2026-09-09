# 0238 — Checking the claims the last two ADRs made

## Status

Accepted — implemented. A recon over the five items ADR 0236 and ADR 0237 left
recorded as "deferred by design", asking of each whether it was a decision or a
guess. Two were decisions. Two were overstated. One was wrong.

## Context

ADR 0215 established that a clean audit result is only worth recording if the
search was real. The same applies to a deferral: "we looked at this and chose
not to act" is only worth writing down if someone looked. This pass re-derived
each claim from the code.

## Finding 1 — a deferral resting on a premise nobody checked

ADR 0236 deferred a wall-clock budget for the Airtable catalog pull, on the
grounds that it is "a nightly cron with no user waiting on it, which is the
entire reason ADR 0231's finding mattered, so the fix would be ceremony".

There is also `POST /catalog/sync` — `catalog.controller.ts`, behind
`PlatformAdminGuard`, synchronous and awaited. An operator does wait on it.

The number the deferral should have been weighed against:

|                           |                 |
| ------------------------- | --------------- |
| `MAX_PAGES`               | 100             |
| `LIST_ATTEMPTS`           | 4               |
| `DEFAULT_HTTP_TIMEOUT_MS` | 15s per attempt |
| `MAX_RETRY_DELAY_MS`      | 30s per backoff |

150s per page, 100 pages: a **ceiling over four hours** on a request a person
triggered. That is ADR 0231's arithmetic exactly, and the only thing that made
it look like ceremony was not checking for a controller.

**Fixed.** `fetch-budget.ts` moves from `integrations/` to `common/` — the
shape is not a CRM idea, and the second caller should not have to import from
another feature folder to say so — and the pull takes a two-minute budget.

**It throws rather than truncating**, which is the opposite of what the three
CRM pulls do with the same helper, and the more important half of this finding.
`deactivateRetired` deactivates every card absent from the fetched set, guarded
only against a fetch of exactly zero. A partial pull handed back as success
would have quietly unpublished everything after the cut-off. A failed sync
leaves yesterday's catalog standing; a truncated one takes the shop down.

Not taken, and worth recording: a proportional guard on `deactivateRetired` —
"refuse to deactivate more than N% in one run". It would fight the feature,
because a genuinely smaller upstream set is exactly how a card gets retired.
With the pull now throwing, no path produces a partial fetch to guard against.

Two mutations caught: removing the check, and returning the partial records
instead of throwing.

## Finding 1b — the loop the guard could not see, and the two it misread

Moving `fetch-budget.ts` broke the guard beside it: it scanned `__dirname`,
which had been the folder holding the three CRM clients and was now `common/`.
The scan went to zero and the suite went red — because that guard carries a
vacuity check, which is the whole argument for writing one. A guard that can
only pass is a guard that says nothing.

Widening it to the API source found a **fifth** paging loop that nobody had
counted: `subscription-invoices.service.ts` pages Stripe invoices to
`MAX_PAGES = 200` behind `POST /admin/subscription-invoices/backfill` —
synchronous, awaited, an operator waiting. Bounded on count, unbounded on time,
exactly like the catalog.

**Fixed**, and it needed no new vocabulary: the summary already carries
`truncated` for hitting the page cap, and expiry sets the same flag. Truncating
is right here where it is wrong for the catalog — every write is an upsert on
Stripe's invoice id and the backfill is documented as safe to re-run, so
stopping early costs a re-run rather than correctness. Three callers, three
meanings for expiry, each following from what its own data does.

And the guard itself was weaker than it looked, in two ways:

- Its header pattern was `for\s*\([^)]*MAX_PAGES[^)]*\)`, which stops at the
  first `)`. Inside `&& !budget.expired()` that is the wrong one — so the three
  CRM clients matched a _truncated_ header that happened to contain the very
  call being searched for. It passed for a reason unrelated to the rule. Parens
  are now balanced rather than pattern-matched.
- It checked the header only, which encoded one team's habit as the rule. A
  loop that throws on expiry, or records `truncated`, cannot say so from a `for`
  condition — so a header scan called the catalog and the backfill unbounded
  while they were the two loops consulting the budget most carefully. It now
  reads the header and the body, and the rule it enforces is the one anyone
  would state out loud: the loop consults the budget somewhere.

A test that the scan can fail was added alongside, since the scan now does
enough work to be wrong quietly.

## Finding 2 — the exact pin was load-bearing, and nobody knew

ADR 0237 argued against exact pins because they cost the automatic flow of
patch releases. `apps/api/package.json` pinned `sanitize-html` at exactly
`2.17.5` — introduced incidentally in #247 with no stated reason — two patches
behind two advisories, on the library implementing the stored-XSS boundary.
That looked like the argument's own worked example, three files from the block
the pass had just been through.

Both halves of that turned out to be wrong, and the second is why this ADR
exists.

**Neither advisory is reachable in our configuration.** Read, rather than
inferred from the package name:

| advisory                                    | requires                             | our config                                            |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| `<=2.17.5`, mutation-XSS via `</textarea/>` | `textarea` or `xmp` in `allowedTags` | allowlist is `b, strong, i, em, u, p, br, ul, ol, li` |
| `<=2.17.6`, SVG SMIL URI-list bypass        | SVG animation allowed                | no SVG tags, `allowedAttributes: {}`                  |

**And the pin is not a pin, it is a version wall.** `sanitize-html@2.17.6`
switched to `htmlparser2@12`, which is `"type": "module"` with no CommonJS
export, and raised its own `engines.node` to `>=22.12` because it now relies on
Node's `require(esm)`. Bumping it:

- does **not** break the API at runtime — `require("sanitize-html")` was
  measured on Node 22.22 and works, which is the opposite of what was expected;
- **does** break the API's Jest, which is ts-jest and CommonJS. Two attempts at
  `transformIgnorePatterns` got from "Cannot use import statement" to
  "Unexpected token 'export'", i.e. into needing `allowJs` and a transform over
  the whole parser chain;
- and sits above the root `engines.node` of `>=22.0.0`.

That is an ESM migration with a runtime floor attached. It should be done —
being stuck behind a wall on the XSS sanitiser gets worse with every release,
and the time to cross it is when nothing is on fire — but not smuggled into a
dependency-hygiene change on the strength of two advisories that cannot reach
us.

**Decided:** `">=2.17.5 <2.17.6"`. The resolved version does not move; what
changes is that the bound is now a decision with its reason recorded and an
explicit unblocking condition, rather than an accident nobody could distinguish
from a typo. `~2.17.5` was tried first and resolves to 2.17.7 — a tilde with a
patch given still floats the patch — which is worth knowing before reaching for
it as "the safe range".

`csv-parse` was assessed the same way and also not upgraded. The advisory needs
`columns: true` **and** `group_columns_by_name: true`; the import passes
`columns: true` with grouping left at its `false` default, and the row-to-object
step uses `Object.fromEntries`, which defines rather than assigns and so does
not invoke a `__proto__` setter. The fix is two majors away. An unreachable
advisory does not justify that upgrade today; it justifies knowing why not.

## Finding 3 — the gate is right, and nothing ran the other audit

CI gates on `pnpm audit --prod --audit-level high`, correctly: a dev-only
advisory cannot reach a customer, and gating on them would leave the step
permanently red, which teaches everyone to ignore it.

The gap was not the scope. It was that nothing ever ran the unscoped audit, so
an `svgo` **high** sat unseen until someone typed it by hand during ADR 0237's
pass. A non-blocking `pnpm audit --audit-level high` now runs after the gate
with `continue-on-error`, so a dev-dependency high is legible in the step list
without being able to stop a deploy.

The step's comment also justified the `--prod` scope by naming a PostCSS and a
js-yaml advisory. Neither exists any more. A comment that describes today's
advisories rather than the rule goes stale while still reading as current — it
was telling the next person the scope was safe for reasons that had stopped
being true. It now describes the rule.

## Finding 4 — a tripwire whose signal nobody receives

ADR 0233 declined the per-account saved-list cap on measured evidence and put a
tripwire in its place, so that "someone is told before it stops being a
deferral". The tripwire was `this.logger.warn`, and the API's Sentry is
errors-only with no console-capture integration — so it reached an application
log nobody tails. It also had no test: nothing caught its removal, or the
comparison being inverted.

**Fixed.** It files a platform notification, the channel this codebase already
uses for operator-actionable signals. Keyed on the _band_ rather than the
account, because `notifyAllAdmins` refuses a duplicate `kind` + `entityId` and
this runs on a page load: unkeyed it would file an alert per visit, which is how
an alert stops being read — the same failure as the silent log, from the other
end. Crossing fifty files one alert; crossing a hundred files one more.

Best-effort, wrapped: the overview is a page a customer is waiting on, and the
count will not change in the next few seconds, so a failed write is the next
load's problem rather than this request's.

Three mutations caught: removing the call, dropping the idempotency key, and
moving the threshold comparison off the boundary.

## What the recon confirmed rather than changed

- The GoHighLevel slug rename (ADR 0234) is exactly as recorded: `gohighlevel`
  is still the `CRM_PROVIDERS` key and so the stored `CrmConnection.provider`,
  still `Recipient.source` (both free-form `String` columns, so a rename is a
  data migration), still the `:provider` path segment on four routes, and still
  the `<option value>` in `SOURCE_OPTIONS` — rendered with `sourceLabel()` as
  its visible text, so the value is the slug and the label is the white-label
  name. Unchanged, trigger unchanged.
- The `settleFulfillment` exemption (ADR 0215) is exactly as recorded:
  `settleFulfillment(tx, batchOrderId)` still has no account in scope, the
  exemption still names a real query, and the guard still fails if it stops
  doing so.

## Consequences

- Two of the five recorded deferrals were re-derivable from the code and stood.
  Two were true but described a weaker mechanism than they claimed. One rested
  on a premise that a single grep would have disproved.
- The pattern in all three misses is the same, and it is the one ADR 0236 was
  itself written about: a conclusion drawn from the part of the system in view.
  A cron was found and a controller was not looked for; a threshold was found
  and its delivery path was not followed; a pin was found and the reason it
  could not move was not tested.
- A deferral is now expected to carry the check that would falsify it, not just
  the argument for it.
