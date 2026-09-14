import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * ADR 0040 draws the line: super admin manages the operator team and platform
 * settings, and `ops` is the role every invited operator starts on. The server
 * enforces it — the API's `admin-mutations-guarded.spec.ts` pins a
 * `SuperAdminGuard` next to every platform-settings mutation — so nothing on
 * this side can grant anything. What this protects is the other half: an ops
 * operator being shown a control they cannot use, pressing it, and collecting a
 * 403.
 *
 * The route list is **derived from the API's own guards** rather than written
 * here, which matters more than it looks. A hand-written rule of "anything
 * under /admin" is wrong in both directions, and was: triaging an enterprise
 * lead, replying to a support ticket and marking your own ops notification read
 * are all `/admin/…` mutations, and all of them are ops work carrying only
 * `PlatformAdminGuard`. Gating those would take away work an operator is hired
 * to do. The API is the only thing that knows which is which.
 */
const OPS = __dirname;

/**
 * The API's source, found by walking up to the workspace root rather than by
 * counting `..` segments — a miscount fails as an ENOENT inside a helper, which
 * says nothing about what is actually wrong.
 */
function apiSrc(): string {
  let dir = OPS;
  for (let up = 0; up < 10; up += 1) {
    const candidate = join(dir, "apps", "api", "src");
    if (existsSync(candidate)) return candidate;
    dir = join(dir, "..");
  }
  throw new Error("Could not find apps/api/src above " + OPS);
}
const API_SRC = apiSrc();

/**
 * Every ops file that calls a super-admin-guarded route, and what gates it.
 *
 * Three shapes, all legitimate:
 *
 * - `SuperAdminEditable` — the panel stays and its controls go inert. For
 *   settings: seeing the configuration is an operator's job, which is exactly
 *   why the API leaves those read routes unrestricted, so hiding the panel
 *   would take away something they are entitled to.
 * - `SuperAdminOnly` — nothing renders at all. For a lone action button, where
 *   there is nothing left to read once it cannot be pressed.
 * - A page-level check — the pages that resolved the role themselves, from
 *   `/admin/me`, before the shared context existed.
 */
const GATED: Record<string, string> = {
  "admin/seat-billing-setup.tsx": "SuperAdminEditable",
  "admin/seasonal-dispatch-setup.tsx": "SuperAdminEditable",
  "admin/dispatch-reminder-setup.tsx": "SuperAdminEditable",
  "admin/print-size-setup.tsx": "SuperAdminEditable",
  "admin/wallet-campaign-setup.tsx": "SuperAdminEditable",
  "admin/daily-summary-button.tsx": "SuperAdminOnly in admin/page.tsx",
  "admin/occasion-scheduler-button.tsx": "SuperAdminOnly in admin/page.tsx",
  "admin/subscription-backfill-button.tsx": "SuperAdminOnly in admin/page.tsx",
  "admin/subscribers/[id]/wallet-adjustment-client.tsx":
    "me.role === super_admin in subscribers/[id]/page.tsx",
  "admin/subscribers/[id]/set-plan-client.tsx":
    "me.role === super_admin in subscribers/[id]/page.tsx",
  "admin/orders/[id]/order-cockpit-client.tsx": "an isSuperAdmin prop, from /admin/me",
  "admin/team/admin-team-client.tsx": "its own team.yourRole check",
};

function sourceFiles(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, keep);
    return keep(path) ? [path] : [];
  });
}

/**
 * The full paths of every route the API guards with `SuperAdminGuard`, read
 * from the controllers themselves.
 *
 * Deliberately the same "read the source next to the route" approach as the
 * API-side guard: what is worth pinning is that somebody wrote the guard down,
 * and compiled metadata would not survive a controller that stopped being
 * registered.
 */
function superAdminRoutes(): { path: string; method: string }[] {
  const GUARD = "@UseGuards(PlatformAdminGuard, SuperAdminGuard)";
  const ROUTE = /@(Post|Put|Patch|Delete)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/;
  const CONTROLLER = /@Controller\(\s*["'`]([^"'`]*)["'`]\s*\)/;

  return sourceFiles(API_SRC, (path) => path.endsWith(".controller.ts")).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    if (!source.includes(GUARD)) return [];
    const prefix = CONTROLLER.exec(source)?.[1] ?? "";
    const lines = source.split("\n");
    const isDecorator = (index: number): boolean => (lines[index] ?? "").trim().startsWith("@");

    return lines.flatMap((line, index) => {
      const route = ROUTE.exec(line.trim());
      if (!route) return [];
      // The whole decorator run, because the controllers put the guard on
      // opposite sides of the route: admin.controller.ts above it,
      // admin-team.controller.ts below. Looking only upwards reported five
      // guarded team routes as unguarded.
      let first = index;
      while (first > 0 && isDecorator(first - 1)) first -= 1;
      let last = index;
      while (last < lines.length - 1 && isDecorator(last + 1)) last += 1;
      if (!lines.slice(first, last + 1).some((entry) => entry.trim() === GUARD)) return [];
      return [
        {
          method: (route[1] ?? "").toUpperCase(),
          path: `/${[prefix, route[2] ?? ""].filter(Boolean).join("/")}`,
        },
      ];
    });
  });
}

/** A route pattern as a matcher: `:id` and a web template hole both stand for
 *  exactly one path segment. */
function routeMatcher(route: string): RegExp {
  const pattern = route
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}

/** Every `/admin/...` URL a file names, with template holes and query strings
 *  reduced to something a route pattern can be matched against. */
function adminUrls(source: string): string[] {
  return [...source.matchAll(/["'`](\/admin\/[^"'`]*)["'`]/g)].map(
    (match) => (match[1] ?? "").replace(/\$\{[^}]*\}/g, "X").split("?")[0] ?? "",
  );
}

/** Whether a file sends any mutating request at all. */
const MUTATES = /method:\s*["'`](?:POST|PUT|PATCH|DELETE)["'`]/;

/**
 * A file this rule applies to: a client component that both names a
 * super-admin route and sends a mutating request.
 *
 * Both halves are needed, and each was learned from a false positive. Path
 * alone is not enough, because `GET` and `PUT /admin/print/card-size` are the
 * same path — the fulfilment page server-renders the print default and gates
 * nothing, correctly. And "client" is not decoration: a server component's read
 * cannot be gated by a React context, and is a read by construction.
 *
 * What is left is the imprecise case — a client file that reads a super-admin
 * path and separately mutates something else. It would fail here and be
 * resolved by adding a line saying so, which is the right outcome for a list
 * whose entries are reasons.
 */
function isClientControl(source: string): boolean {
  return /^\s*["']use client["']/m.test(source) && MUTATES.test(source);
}

describe("the ops surface", () => {
  const routes = superAdminRoutes();
  const paths = routes.map((route) => route.path);
  const matchers = paths.map(routeMatcher);
  const files = sourceFiles(OPS, (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)).map(
    (path) => ({ name: path.slice(OPS.length + 1), source: readFileSync(path, "utf8") }),
  );

  it("reads the API's guards at all (the derivation still works)", () => {
    // Vacuity check: an empty route list would make the rule below pass while
    // gating nothing.
    expect(routes.length).toBeGreaterThanOrEqual(18);
    expect(paths).toContain("/admin/customers/:id/wallet-adjustment");
    expect(paths).toContain("/admin/wallet-campaigns");
    // Read from below the route decorator, which is where this controller puts
    // the guard — the order the first version of this scan could not see.
    expect(paths).toContain("/admin/team/:userId");
    // And that ops work is *not* in the list — the distinction this rests on.
    expect(paths).not.toContain("/admin/support/:id");
    expect(paths).not.toContain("/admin/notifications/read-all");
    expect(paths).not.toContain("/admin/enterprise-enquiries/:id");
  });

  it("gates every control that reaches a super-admin route", () => {
    const callers = files
      .filter((file) => isClientControl(file.source))
      .filter((file) =>
        adminUrls(file.source).some((url) => matchers.some((matcher) => matcher.test(url))),
      )
      .map((file) => file.name);
    // Exact, in both directions: an ungated new panel fails, and so does an
    // entry left behind by a file that no longer calls one of these routes.
    expect(callers.sort()).toEqual(Object.keys(GATED).sort());
  });

  it("gates them the way the list says", () => {
    const sourceOf = (name: string) => files.find((file) => file.name === name)?.source ?? "";
    const wrong = Object.entries(GATED)
      .filter(([name, gate]) => {
        const marker = /^(SuperAdminEditable|SuperAdminOnly)/.exec(gate)?.[1];
        if (!marker) return false; // A page-level check, named in the value.
        const where = gate.includes("in admin/page.tsx")
          ? sourceOf("admin/page.tsx")
          : sourceOf(name);
        // The JSX element, not the bare name: deleting the wrapper while
        // leaving the import behind is exactly what a half-finished edit looks
        // like, and the first version of this check waved it through.
        return !where.includes(`<${marker}>`);
      })
      .map(([name]) => name);
    expect(wrong).toEqual([]);
  });

  it("would notice an ungated call — the matching is what call sites write", () => {
    // Proves the scan can fail. Without this, a broken pattern would let every
    // panel through while ops operators collected 403s.
    const matcher = routeMatcher("/admin/customers/:id/wallet-adjustment");
    expect(
      adminUrls("clientApiFetch(`/admin/customers/${accountId}/wallet-adjustment`, {"),
    ).toEqual(["/admin/customers/X/wallet-adjustment"]);
    expect(matcher.test("/admin/customers/X/wallet-adjustment")).toBe(true);
    // A query string is not part of the route.
    expect(adminUrls("mutate(`/admin/team/invites?email=${encodeURIComponent(e)}`, {")).toEqual([
      "/admin/team/invites",
    ]);
    // And a near-miss does not match: one segment means one segment.
    expect(matcher.test("/admin/customers/X")).toBe(false);
    expect(matcher.test("/admin/customers/X/y/wallet-adjustment")).toBe(false);

    // The gate marker is the element, so an orphaned import does not count.
    expect(
      'import { SuperAdminEditable } from "../ops-role";'.includes("<SuperAdminEditable>"),
    ).toBe(false);

    // A server component naming the same path is a read, and out of scope.
    expect(isClientControl('serverApiFetch("/admin/print/card-size")')).toBe(false);
    expect(
      isClientControl('"use client";\nclientApiFetch("/admin/print/card-size", { method: "PUT" })'),
    ).toBe(true);
  });
});
