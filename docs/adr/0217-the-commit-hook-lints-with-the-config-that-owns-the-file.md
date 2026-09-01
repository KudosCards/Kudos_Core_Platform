# 0217 — The commit hook lints with the config that owns the file

## Status

Accepted — implemented.

## Context

`.husky/pre-commit` ran Prettier and nothing else, and said why:

> Formatting only, deliberately — no `eslint --fix`. ESLint lives in each
> package, not at the root, with a flat config that resolves from the working
> directory; a root-level `eslint` here finds whatever happens to be on PATH
> (a global install, a different major version) and no config to run it with.
> Linting stays where it works: `pnpm turbo run lint`, per package, in CI.

Every word of that is true, and it is the right objection to the naive fix. It
is not an argument against linting on commit — only against linting from the
root.

The cost of leaving it was a five-minute round trip for mistakes visible in
seconds. Over the weekend's 27 pull requests the loop ran repeatedly: commit,
push, wait for "Lint, typecheck, test, build", read a one-line ESLint error,
fix, push again. The ADR-index failure on #409 was the same shape — a check that
takes under a second locally, found four minutes into CI.

## Decision

`scripts/lint-staged-eslint.mjs` groups the staged files by the workspace that
owns them and runs _that workspace's_ ESLint binary with that workspace as its
working directory.

That answers the hook's objection directly rather than working around it:

- **The config resolves.** `apps/api` sets `parserOptions.project` with
  `tsconfigRootDir`, so its type-aware rules need that directory. `apps/web`
  scopes its design-token rule to `files: ["src/app/(app)/**/*.tsx", …]` —
  patterns that match nothing from the repo root. Run from the right cwd, both
  behave exactly as `pnpm turbo run lint` makes them behave. The hook and CI
  cannot disagree about what an error is, because they run the same thing.
- **The binary is the workspace's own.** `node_modules/.bin/eslint` inside the
  workspace, never whatever is on PATH. If it is missing the hook says
  "run `pnpm install`" and fails, rather than silently linting with a stranger.
- **Workspaces are discovered, not listed.** The script walks up from each file
  to the nearest directory holding an `eslint.config.*`. A fourth workspace with
  its own config is covered the day it appears; one _without_ a config is
  reported by name and fails the commit, because a hook that quietly skips
  things is how this repo got 248 unformatted files in the first place.

`--no-warn-ignored` is not incidental. Without it, staging a file the workspace
ignores — `apps/api/eslint.config.mjs` itself, anything under `dist/` — emits
"File ignored because of a matching ignore pattern", and `--max-warnings 0`
turns that warning into a blocked commit. Editing the ESLint config would be the
one change you could not commit.

`lint-staged --concurrent false`, because Prettier writes the files ESLint then
reads. Run in parallel, ESLint can read one mid-write: a parse error that
depends on timing, which is the worst kind of failure to put in a commit hook.

**No `--fix`.** The hook reports; it does not rewrite code on its way into a
commit without showing anyone. Prettier is already an exception to that, and one
is enough.

## What it costs

Measured on this machine, warm:

| staged               | hook |
| -------------------- | ---- |
| 1 shared-types file  | 1.5s |
| 1 web file           | 1.6s |
| 1 API file           | 3.8s |
| 12 API files         | 5.3s |
| all three workspaces | 6.6s |

Prettier adds ~0.5s. So an ordinary commit pays two to six seconds.

The API is the slow one and is slow for a reason: type-aware linting builds the
program from `tsconfig.json` before it checks anything, which is why twelve
files cost barely more than one. That shape is what makes this viable at all.

For comparison, `pnpm lint` across the repo is ~31s warm and ~88s from a cold
cache. Wiring the hook to that instead would have been abandoned within a day.

## Consequences

- Lint errors are found where they are cheapest, in the file you just wrote.
- CI keeps its own `pnpm turbo run lint`. Nothing here replaces it, and the
  hook is skippable with `--no-verify`, which is the point of a backstop.
- The workspace-discovery walk means this does not need editing when the repo
  grows.

## What this does not do

**It is not the full lint, and cannot be.** ESLint sees only the staged files.
A type-aware rule can flag a file that is not staged — an export whose signature
changed breaking its consumer — and only the whole-workspace run finds that.
The hook catches the mistakes you just made in the files you just touched, which
is most of them; CI still has to catch the rest. Claiming otherwise would invite
exactly the false confidence that makes a green hook worse than no hook.

**It does not lint the root.** `scripts/*.mjs` has no ESLint config above it, so
those files are not linted here — and they are not linted by
`pnpm turbo run lint` either, which has no root task. That is a real gap, named
rather than hidden. It is not closed here because a root config is a decision
about which rules apply to build scripts, not a side effect of a commit hook.
The `lint-staged` glob is scoped to `{apps,packages}/**` so those files are not
sent to the script at all, and the script's "no config covers this" failure is
reserved for a genuine gap inside a workspace.
