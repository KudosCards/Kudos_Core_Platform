# ADR 0029 — The API build regenerates the Prisma client (`prebuild`), not just `postinstall`

Status: accepted
Date: 2026-07-23

## Context

The multi-user-teams deploy (PR #82) **failed on Railway at the image-build step** — "Failed to
build an image" — even though the same commit was green in CI ("Lint, typecheck, test, build") and
built cleanly locally.

The failure could not be reproduced from the code. Railway's Build Command is
`pnpm --filter @kudos/api build` (see ADR 0007), so the API service builds only the API — not the
web app — which rules out a Next.js build OOM. Reproducing Railway's exact sequence locally from a
pristine state all passed:

- `rm -rf node_modules` → `pnpm install --frozen-lockfile` runs the workspace postinstalls
  (shared-types `tsc`, api `prisma generate`), producing a **Prisma Client v5.22.0** (the pinned
  version) that **does** include the new `Invite` / `InviteStatus` / `Membership.email` /
  `PlanEntitlement.teamSeatsEnabled` members;
- `pnpm --filter @kudos/api build` (`nest build`) then compiles cleanly against it;
- `prisma generate` even succeeds with `DATABASE_URL` unset (build phase).

So the code is correct against Railway's pinned toolchain. That leaves two environmental causes:

1. a **transient Railway builder failure** (the generic "Failed to build an image" wrapper), or
2. a **stale Nixpacks install-layer cache** — Railway reusing a cached `node_modules` whose
   generated Prisma client predates the schema change, so `nest build` compiles against a client
   missing the new `Invite` model and fails.

Cause (2) is the same class of latent bug ADR 0007 fixed for `shared-types`: **Railway's Build
Command bypasses the mechanism the correctness depends on.** There, `pnpm --filter @kudos/api build`
bypassed Turbo's `dependsOn: ["^build"]`; here it relies on the *install* step's `postinstall`
having regenerated the Prisma client, which a cached install layer can skip.

## Decision

Add `"prebuild": "prisma generate"` to `apps/api`. `pnpm run build` runs `prebuild` first, so
`pnpm --filter @kudos/api build` now **regenerates the Prisma client every build**, against the
current schema, regardless of whether the install step (or its cache) ran `postinstall`. The
existing `postinstall: prisma generate` stays for the local `pnpm install` developer flow; the two
together make client generation belt-and-suspenders.

This directly eliminates cause (2), and pushing the change also forces a fresh Railway deploy, which
resolves cause (1) if it was transient. Verified that `prebuild` fires before `nest build` by
deleting the generated client and running only the build command.

## Consequences

- Schema changes can never again produce a Railway image-build failure from a stale cached client —
  the build owns client generation, not just install.
- Negligible cost: `prisma generate` adds ~0.3s and needs no database connection.
- If a Railway image build still fails after this, the cause is environmental (transient/quota) and
  the **Build Logs** tab is the source of truth — the local reproduction of Railway's exact command
  is the check that proves the code itself is not at fault.
