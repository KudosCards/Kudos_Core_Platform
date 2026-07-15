# Kudos Cards Platform

Web-first rebuild of Kudos Cards: automated, personalised physical recognition (birthdays,
achievements, leavers, staff recognition, seasonal/bespoke campaigns) for organisations and
individuals, with its own API from day one so a native app can follow later without a rewrite.

See the full architecture, domain model, and roadmap in the platform plan shared with the team,
and the reasoning behind key decisions in [`docs/adr`](./docs/adr).

## Structure

```
apps/
  web/            # Next.js — marketing site + authenticated app + public QR message pages
  api/            # NestJS — all business logic, the only writer to the database
packages/
  shared-types/   # Zod schemas shared between web and api — the single source of truth for domain types
  config/         # Shared TypeScript/ESLint/Prettier config
docs/
  adr/            # Architecture Decision Records
```

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 10 (`corepack enable` will pick up the pinned version from `package.json`)
- A local PostgreSQL 16 instance for `apps/api` (or point `DATABASE_URL`/`DIRECT_URL` at a
  Supabase project)

## Getting started

```bash
pnpm install                     # also generates the Prisma client (apps/api postinstall)

cp apps/api/.env.example apps/api/.env   # fill in DATABASE_URL/DIRECT_URL and the rest
cp apps/web/.env.example apps/web/.env

pnpm --filter @kudos/api exec prisma migrate dev   # apply the schema to your local database
pnpm --filter @kudos/api exec prisma db seed       # seed plan entitlements (free/pro/centre)

pnpm dev                         # runs both apps via Turborepo
```

The API serves Swagger docs at `/docs` outside production, and a health check at `/health`.

Auth is Supabase-backed (`@supabase/ssr`) — you'll need a real Supabase project's URL/anon key in
`apps/web/.env` and matching `SUPABASE_*` values in `apps/api/.env` for signup/login to work. The
API's auth guard verifies session tokens against the project's published JWKS
(`SUPABASE_URL` + `/auth/v1/.well-known/jwks.json`) — no shared secret involved, and it re-fetches
automatically if Supabase rotates the signing key. The test suite doesn't need a live Supabase
project at all: e2e tests swap in a local JWKS built from a real generated keypair (see
`apps/api/test/util/test-jwks.ts`), and everything else runs against a plain local Postgres
instance.

## Common commands

Run at the repo root — Turborepo fans these out to every package:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The API additionally has `pnpm --filter @kudos/api test:e2e` for its Supertest suite.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, the API's e2e suite (against a real
Postgres service container, with migrations and the seed applied first), and a full build on
every PR.

## Deployment

- **API** (Railway): builds with `pnpm --filter @kudos/api build`, starts with
  `pnpm --filter @kudos/api start:deploy`. That script runs `prisma migrate deploy` before
  booting the server, so every deploy applies any new migrations automatically — no manual
  migration step needed once the service's `DATABASE_URL`/`DIRECT_URL` point at the real
  database. `prisma db seed` is intentionally *not* run on every deploy (seeding isn't something
  you want firing automatically); run it once by hand via the platform's console/shell after the
  first successful deploy: `pnpm --filter @kudos/api exec prisma db seed`.
- **Web** (Netlify): auto-deploys on every push to `main`. Needs `NEXT_PUBLIC_API_URL` pointed at
  the live API URL, and the API's `WEB_APP_URL` pointed back at the live web URL (for CORS).
