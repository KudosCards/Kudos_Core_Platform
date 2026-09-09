# 0239 — Crossing the ESM wall in front of the sanitiser

## Status

Accepted — implemented. The follow-up ADR 0238 named and deliberately deferred:
taking `sanitize-html` past 2.17.6 now, while nothing is on fire, rather than
under an advisory that does reach us.

## Context

ADR 0238 found that `sanitize-html` was not pinned so much as walled in.
Version 2.17.6 moved to `htmlparser2@12` — `"type": "module"`, no CommonJS
export — and raised its own `engines.node` to `>=22.12.0` because it now relies
on Node's `require(esm)`.

Two things followed from that, and only one was a problem:

- **The runtime was never affected.** `require("sanitize-html")` was measured on
  Node 22.22 and works. That is the opposite of what was expected — the guess
  was `ERR_REQUIRE_ESM` at boot — and it is why this could be deferred at all.
- **The API's Jest could not load it.** Jest has its own module registry and
  does not implement `require(esm)`, so the suite failed with
  "Cannot use import statement outside a module" pointing into `htmlparser2`.

So the bound went in as `">=2.17.5 <2.17.6"` with the reason recorded, and this
is the work that removes it.

## The tempting shortcut, and why it is one

Both advisories the bound held us behind are unreachable in our configuration —
one needs `textarea`/`xmp` in `allowedTags`, the other needs SVG animation
allowed, and the message allowlist is ten inline tags with no attributes. So
there is a version of this decision that says: leave it, nothing can reach us.

That reasoning expires. Every release widens the gap, and the release that
finally carries an advisory we _can_ reach is the one where crossing an ESM
migration becomes urgent. The time to do it is now, when the only cost of
getting it wrong is a red suite.

## Decision

Compile the ESM dependencies for the test runs only.

**A separate `tsconfig.spec.json`.** `allowJs` is what lets ts-jest compile
third-party `.js`, and it has no business in the build config — it would put
somebody else's JavaScript through `tsc` on the way to `dist/`, which is what
ships. `checkJs` stays off: compile them, don't type-check them; their
diagnostics are not ours to fix.

**A `transformIgnorePatterns` anchored on the whole path.** The obvious form,
`node_modules/(?!\.pnpm/(…)@)`, does not work under pnpm and fails _silently_.
A pnpm path contains two `node_modules` segments —
`/node_modules/.pnpm/htmlparser2@12.0.0/node_modules/htmlparser2/dist/index.js`
— and the negative lookahead succeeds at the second one, so the file matches the
ignore pattern and is left untransformed. The working form is
`^(?!.*\.pnpm/(?:…)@).*node_modules`: a path is ignored only if the _entire_
path names none of the packages.

**The Node floor is now declared, and enforced.** Root `engines.node` moves from
`>=22.0.0` to `>=22.12.0`, matching what `sanitize-html` requires. A declaration
nothing checks is a comment, so `.npmrc` gains `engine-strict=true`: `pnpm
install` refuses a Node below the floor. Verified by temporarily declaring
`>=99.0.0` and watching the install fail rather than assuming it would.

That trade is deliberate. Without it, a deploy onto an older Node installs
happily and dies at boot on the first `require`; with it, it fails at install
with a message naming the required version. A build failure is the better of
the two.

## The guard, and why the list needed one

The seven packages to transform are `htmlparser2`, `entities`, `domhandler`,
`domutils`, `dom-serializer`, `domelementtype` and `nanoid` (the last via
`postcss`). That list is a hand-written enumeration of somebody else's
dependency tree — precisely the shape ADR 0237 and ADR 0238 were both about.

It is also worth recording _how_ it was first assembled: by running the suite,
reading the error, adding the package it named, and running again. Three rounds
of that. It arrives at the right answer and teaches nothing, and the next person
inherits a list with no way to tell whether it is still complete.

So `esm-deps-are-transformed.spec.ts` walks `sanitize-html`'s actual dependency
closure on disk, collects everything with `"type": "module"`, and asserts both
Jest configs name exactly that set. Exactly, in both directions: a missing name
is a suite that breaks on the next install, and a stale one is a package being
compiled for no reason with a reader left guessing which problem they have.

It carries two vacuity checks, because a walk that returns nothing would make
every assertion below it pass. One asserts the closure is bigger than
`sanitize-html`'s direct dependency count; the other asserts at least one ESM
package was found, since a zero there means the type detection broke rather than
that the problem went away.

Two mutations, both caught: dropping a package from the list, and adding one
that is not ESM.

## Consequences

- `sanitize-html` moves to `^2.17.7`, clearing both advisories. Three moderate
  advisories remain, none in a reachable configuration: two `qs` under
  `supertest`, and `csv-parse`, assessed in ADR 0238.
- The API now genuinely requires Node ≥22.12, and says so in a place that is
  checked rather than only read.
- Test runs compile seven small third-party packages. Jest caches transforms, so
  the cost lands once per cache generation rather than per run.
- The build config is untouched, so `dist/` is produced by exactly the compiler
  settings it was before. The compiled output was loaded directly and exercised
  through the sanitiser to confirm it, rather than inferring it from a green
  suite.
- If `sanitize-html` ever returns to a CommonJS parser, the guard's second
  vacuity check is what will say so — the ESM list drops to empty and the whole
  mechanism can be deleted.
