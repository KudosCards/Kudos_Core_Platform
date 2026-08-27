import { PrismaClient } from "@prisma/client";

/**
 * Empty the database before every e2e spec file, so suites cannot see each
 * other's data.
 *
 * The e2e suites share one database and nothing ever cleared it, so a run
 * accumulated: 456 accounts, 1,108 audit rows and 115 fulfilment jobs by the
 * end. That is invisible until a suite asserts against a *platform-global*
 * endpoint — and the ops surfaces are global by design, because an operator
 * works one queue across every account.
 *
 * Those assertions read a truncated response, which is where it bites:
 *
 * | Assertion | Cut-off |
 * | --- | --- |
 * | "sees pending jobs across different accounts" | `perPage=100` |
 * | "filters and orders the queue by dispatch deadline" | `perPage=200` |
 * | "must-ship spans every not-yet-posted card" | `MUST_SHIP_LIMIT = 50`, server-side |
 *
 * A whole run left **86 pending jobs** against that first `perPage=100` — a
 * margin of fourteen. CI was green only because its container starts fresh, and
 * sixteen e2e specs create paid orders, so a PR adding ~15 more fixtures would
 * have turned those three red **in CI** for a reason unrelated to the change.
 * The third one cannot even be fixed from the test: its cap is in
 * `fulfillment.service.ts`.
 *
 * Resetting per file rather than per run is what makes each suite's footprint
 * knowable: `fulfillment.e2e-spec.ts` creates 43 jobs of its own, 25 of them
 * inside the must-ship window, so the tightest margin goes from 14/100 to 25/50.
 * Not unlimited — but a suite's own fixtures are something its author can see.
 *
 * ## Why this can work at all
 *
 * Two things were verified before writing it, because the whole design rests on
 * them:
 *
 * - **A setup file's `beforeAll` runs before the spec's own.** So this empties
 *   the database before `createTestApp()`, not after.
 * - **Module state does not leak between spec files.** Each file gets its own
 *   registry, probed in both directions. That matters because
 *   `DispatchConfigService` pushes seasonal rules into module-level state at
 *   boot — if that leaked, no amount of truncating would isolate anything. It
 *   does not, so the shared database was the only coupling, and this closes it.
 */

/**
 * What survives: Prisma's own bookkeeping, and the two tables `prisma db seed`
 * fills. Everything else is test data.
 *
 * Deliberately a keep-list read against the live table list rather than a
 * hard-coded list of tables to empty. A table added later is then isolated
 * automatically, and the failure mode of forgetting this list is loud and
 * immediate — seeded rows vanish and every suite fails at once — where
 * forgetting to extend a truncate-list would quietly degrade isolation months
 * later.
 */
const KEEP = new Set(["_prisma_migrations", "plan_entitlements", "card_designs"]);

let prisma: PrismaClient | undefined;

beforeAll(async () => {
  prisma = new PrismaClient();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = tables
    .map((row) => row.tablename)
    .filter((name) => !KEEP.has(name))
    // These names come from the catalog, not from anything a test controls, but
    // they are about to be interpolated into SQL — so refuse anything that
    // could not be a plain identifier rather than quoting and hoping.
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name));

  if (targets.length === 0) return;

  // One statement: TRUNCATE takes a single lock over the lot and is far faster
  // than DELETE, which would have to walk every row and fire every FK check.
  // CASCADE covers tables that reference these; RESTART IDENTITY resets the
  // sequences behind `orderNumber` and friends, so ordinals start from 1 in
  // every suite instead of drifting with the run.
  const list = targets.map((name) => `"public"."${name}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  // Each spec file gets its own module registry, so this client is this file's
  // alone. Closing it keeps the connection count flat across the run.
  await prisma?.$disconnect();
  prisma = undefined;
});
