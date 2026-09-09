# 0237 — An override that permits any future major

## Status

Accepted — implemented. The floor-versus-pin pass over `pnpm.overrides` that
ADR 0235 asked for, after two entries in one week were found sitting on
versions that had become vulnerable.

## Context

Every entry in the block was added for the same reason: an advisory was
published, `pnpm audit` turned CI red, and the entry moved us past it. Each was
written as a bare lower bound.

```json
"browserslist": ">=4.28.7",
"fast-uri":     ">=4.1.3",
"js-yaml":      ">=4.3.1",
"postcss":      ">=8.5.23",
"multer":       ">=2.3.0",
"sharp":        ">=0.35.4"
```

ADR 0235 read `fast-uri` and `sharp` as having "drifted into the vulnerable
range" and called the floor the cause. That is not quite right, and the
distinction decides what the fix should be:

- **A floor does not cause an advisory.** `pnpm-lock.yaml` pins exact versions
  and every install here is `--frozen-lockfile`, so the resolved version does
  not move on its own. When an advisory lands against whatever is pinned, an
  exact pin and a floor fail identically — the audit goes red and a person
  raises it. `fast-uri` pinned exactly at 4.1.2 would have been just as
  vulnerable that morning.
- **What a floor does cause is an unreviewed major.** `>=` has no upper bound,
  so whenever the lockfile is regenerated — which adding one unrelated
  dependency will do — a transitive package may cross a major boundary with no
  diff in `package.json` and nothing to review. That is how `fast-uri` came to
  be on 4.x at all.

So the pass is not a security control. It is about what can change without
anyone deciding it.

## The one that had already happened

`js-yaml` was overridden to `>=4.3.1` for a dev-only advisory under
`@eslint/eslintrc`. The lockfile had it at **5.3.0**.

Its only consumer is `@eslint/eslintrc`, which declares `js-yaml: ^4.3.0`. We
were forcing a major above what the one package that uses it asks for, and
nobody chose that — it arrived with some other install.

Nothing broke, and the reason is worth recording rather than taking as
reassurance: that dependency exists to load `.eslintrc.yml`-style config, this
repo has none (every workspace uses a flat `eslint.config.mjs`), so the code
path is dormant. It went unnoticed because it is unexercised, which is exactly
the condition under which a silent major stays silent until it doesn't.

## Decision

Bound every override to its major, rather than pinning it exactly.

```json
"browserslist": "^4.28.7",
"fast-uri":     "^4.1.3",
"js-yaml":      "^4.3.1",
"postcss":      "^8.5.23",
"multer":       "^2.3.0",
"sharp":        "^0.35.4"
```

Exact pins were considered and rejected. The lockfile already provides
reproducibility, so a pin adds little there, and it costs the automatic flow of
patch releases — meaning every patch becomes a manual bump, which is how
entries go stale. A caret keeps the patches and removes the silent major.

`sharp` is `0.x`, where the minor is the breaking axis; `^0.35.4` therefore
means `>=0.35.4 <0.36.0`, which is what we want. It also now matches the
`"sharp": "^0.35.4"` both apps declare directly — the override had been
_looser_ than the dependency it overrides, which is backwards.

One resolution changed: **js-yaml 5.3.0 → 4.3.2**, back inside the range its
consumer declares, still clear of the advisory the entry exists for. The other
five resolved to exactly what they already were, which is the result to want
from a policy change: the block now says what it has been doing.

## The advisory found on the way

`pnpm audit` without `--prod` reported one **high**: `svgo`
(GHSA-w27v-7q3p-w38r, `removeScripts` allows executable links through
namespaced attributes), fixed in 4.1.0. The lockfile had 4.0.2.

CI gates on `pnpm audit --prod --audit-level high`. `svgo` is a devDependency
of `apps/web`, so the gate cannot see it — correctly, by the reasoning ADR 0209
gives for scoping the gate to what ships. It is used by
`scripts/build-clipart.mjs` to optimise our own source artwork, so nothing
untrusted reaches it and the practical exposure is small.

It is also a second illustration of the same point. The declared range was
`^4.0.2`, which permits 4.1.0 — the range was never the constraint, the
lockfile was, and `pnpm install` does not move within a range on its own. Raised
to `^4.1.0` so the _declared_ range excludes the vulnerable window rather than
relying on a lockfile that happens to have been refreshed. `svgo` brought
`css-select` 5→6 and `css-what` 6→7 with it, within its own declared ranges.

`optimize()` was run with `build-clipart.mjs`'s exact config on 4.1.0:
dimensions stripped, `viewBox` kept, comments and empty groups removed. Same
output shape.

## Consequences

- A transitive dependency in this block can no longer cross a major without an
  edit to `package.json`.
- Patch and minor fixes still arrive on a re-resolve, so entries do not go
  stale the way exact pins would.
- The dev-only advisory surface is still not gated by CI, and this pass does not
  change that. It was found by running the audit without `--prod` by hand.
  Widening the gate is a separate decision with a real cost — dev advisories are
  frequent and mostly unreachable — and is deliberately not taken here. What is
  recorded is that the unscoped audit is worth running during a dependency pass,
  because the gate is scoped for good reasons and those reasons leave a gap.
- Five moderate advisories remain, unchanged by this work and below the gate.
