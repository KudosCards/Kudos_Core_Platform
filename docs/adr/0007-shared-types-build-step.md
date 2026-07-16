# ADR 0007 — `packages/shared-types` compiles to `dist/`, not consumed as raw source

Status: accepted
Date: 2026-07-16

## Context

ADR 0001 promised `packages/shared-types` would be "consumed by both API DTOs and frontend code."
In practice, through the end of Phase 1, the API side of that promise was never actually
exercised — every API import from `@kudos/shared-types` was `import type`, erased at compile
time, so the package's `"main": "./src/index.ts"` (raw, unbuilt TypeScript source) never had to
survive a real Node `require()` at runtime.

Phase 2's `saved-designs.service.ts` is the first place the API needs a shared-types *value*, not
just a type: `designDocumentSchema`, to validate a design document's complex nested/discriminated-
union JSON shape (something `class-validator` can't express cleanly, and the exact kind of
validation `packages/shared-types` exists to centralise — see the reuse-angle finding in the
full-repo review that flagged this validation as duplicated and unwired).

Running the compiled API (`node dist/main.js`, the same command Railway's `start:deploy` runs)
surfaced the real bug: Node's module loader, requiring a raw `.ts` file, hit
`ERR_MODULE_NOT_FOUND` resolving `packages/shared-types/src/index.ts`'s extensionless
`export * from "./enums"`. Jest (via ts-jest) and Next.js (via Turbopack) both have their own
TypeScript-aware resolution and never hit this, so it stayed invisible through typecheck, lint,
unit tests, and even `next build` — only actually running the compiled server caught it.

## Decision

Give `packages/shared-types` a real build step: `tsc -p tsconfig.build.json` compiling to
`dist/` (CommonJS, matching `apps/api`'s own `module: commonjs`), with `package.json`'s
`main`/`types`/`exports` pointing at the compiled output instead of raw `src/`. The build runs
as the package's own `postinstall` — guaranteed to happen on any `pnpm install`, regardless of
which build command subsequently runs `nest build` (Railway's configured Build Command,
`pnpm --filter @kudos/api build`, bypasses Turborepo's `dependsOn: ["^build"]` graph entirely, so
relying on that graph alone would have left production silently broken).

## Alternatives considered

- **Don't import shared-types values from the API; duplicate the validation locally instead** —
  rejected: this is exactly the "three validators disagree" pattern the full-repo review flagged
  as a real bug elsewhere (CSV import's email regex). Un-wiring shared-types again after finally
  wiring it in for a case it's genuinely suited for would be a regression, not a fix.
- **Rely on Turborepo's `dependsOn: ["^build"]` alone** — this already works for `pnpm build`/
  `pnpm typecheck`/`pnpm lint` run at the repo root, but Railway's Build Command calls
  `pnpm --filter @kudos/api build` directly, never invoking Turbo. A fix that only works when
  Turbo is in the loop doesn't actually fix production.
- **Bundle `apps/api` with esbuild/webpack** instead of plain `tsc` + `node dist/main.js` — would
  sidestep the raw-`.ts`-require issue a different way, but is a much larger change to a deploy
  pipeline that's already working, for a problem the postinstall fix solves directly.

## Consequences

- `packages/shared-types` now behaves like a normal compiled workspace dependency for every
  consumer, not just the ones with their own TypeScript-aware bundler.
- `dist/` is gitignored, generated on install/build like `apps/api/dist` and `apps/web/.next`
  already are.
- This was a latent production bug — the *currently deployed* Railway API would have crashed on
  boot the moment any code path required a shared-types value at runtime. Merging this fix is
  what makes Phase 2's `saved-designs` endpoints deployable at all, not an optional cleanup.
- Confirmed by actually running the compiled server locally (`node apps/api/dist/main.js`) against
  a real Postgres instance and hitting `/health` — the kind of check that would have caught this
  before Phase 1 shipped invisibly, and now the standing practice for infra-relevant changes.
