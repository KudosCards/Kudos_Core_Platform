import { redirect } from "next/navigation";
import Link from "next/link";
import type { AdminIdentity, MustShipSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { LogoutButton } from "../(app)/logout-button";
import { OpsNotificationBell } from "./ops-notification-bell";
import { Logo } from "@/components/logo";

/**
 * The internal ops shell — a separate surface from the customer app, with its
 * own operator sign-in (/admin-login). Gated on platform-operator status (GET
 * /admin/me), which also returns the operator's identity + role so the shell
 * can show who's signed in and gate the Team page to super admins. See
 * docs/adr/0010 and docs/adr/0040-admin-auth.md.
 */
export default async function OpsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const me = await serverApiFetch<AdminIdentity>("/admin/me").catch((error: unknown) => {
    // 403 = authenticated but not a Kudos operator — send them to the operator
    // sign-in, which explains they need operator access (rather than the
    // customer app or a dead end).
    if (error instanceof ApiError && error.status === 403) {
      redirect("/admin-login");
    }
    throw error;
  });
  if (!me) {
    // No session at all — the operator needs to sign in on the ops surface.
    redirect("/admin-login");
  }

  // Send-by-5 SLA banner: a page-agnostic, high-priority alert whenever a card
  // is overdue or must post today, on every ops screen so it can't be missed.
  // Non-fatal if it fails — the shell must still render. See ADR 0115.
  const mustShip = await serverApiFetch<MustShipSummary>("/fulfillment/must-ship").catch(
    () => null,
  );
  const shipAlert =
    mustShip && (mustShip.overdue > 0 || mustShip.today > 0)
      ? mustShip.overdue > 0
        ? {
            urgent: true,
            text: `${mustShip.overdue} card${mustShip.overdue === 1 ? "" : "s"} overdue to post`,
          }
        : {
            urgent: false,
            text: `${mustShip.today} card${mustShip.today === 1 ? "" : "s"} to post today`,
          }
      : null;

  const navItems = [
    { href: "/admin", label: "Dashboard", group: "Overview" },
    { href: "/admin/orders", label: "Orders", group: "Overview" },
    { href: "/admin/subscribers", label: "Customers", group: "Overview" },
    { href: "/fulfillment", label: "Fulfillment queue", group: "Operations" },
    { href: "/fulfillment/calendar", label: "Dispatch calendar", group: "Operations" },
    { href: "/admin/support", label: "Support", group: "Operations" },
    { href: "/admin/returns", label: "Returned to sender", group: "Operations" },
    { href: "/admin/enterprise", label: "Enterprise leads", group: "Operations" },
    { href: "/catalog", label: "Card catalog", group: "Operations" },
    { href: "/storage", label: "Storage cleanup", group: "Operations" },
    // Team management is a super-admin-only surface.
    ...(me.role === "super_admin"
      ? [{ href: "/admin/team", label: "Operators", group: "Administration" }]
      : []),
  ];
  const groups = ["Overview", "Operations", "Administration"].filter((group) =>
    navItems.some((item) => item.group === group),
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      {/* Desktop sidebar — brand + nav only. Operator identity, notifications and
          sign-out live in the content-column top bar (below). */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-black/10 px-4 py-6 lg:flex dark:border-white/10">
        <div className="flex flex-col gap-2 text-sm font-medium">
          {/* Brand — the Kudos mark, linking back to the ops dashboard. */}
          <Link href="/admin" className="mb-4 flex items-center gap-2 px-3">
            <Logo className="h-11 w-auto" priority />
            <span className="text-sm font-semibold tracking-tight">Ops</span>
          </Link>
          {groups.map((group) => (
            <div key={group} className="flex flex-col gap-2">
              <span className="mt-3 px-3 text-xs font-semibold tracking-wide text-foreground/40 uppercase first:mt-0">
                {group}
              </span>
              {navItems
                .filter((item) => item.group === group)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  >
                    {item.label}
                  </Link>
                ))}
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — sticky across breakpoints. Notifications + sign-out sit
            top-right (the conventional place); the brand shows on mobile where
            there's no sidebar, and the operator identity on desktop. */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-black/10 bg-surface px-4 py-2.5 sm:px-6 lg:px-8 dark:border-white/10">
          <Link href="/admin" className="flex items-center gap-2 lg:hidden">
            <Logo className="h-8 w-auto" priority />
            <span className="text-sm font-semibold">Ops</span>
          </Link>
          <div className="hidden min-w-0 lg:block">
            <p
              className="truncate text-sm font-medium text-foreground/80"
              title={me.email ?? undefined}
            >
              {me.email ?? "Operator"}
            </p>
            <p className="text-xs text-foreground/40">
              {me.role === "super_admin" ? "Super admin" : "Operator"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <OpsNotificationBell />
            <LogoutButton redirectTo="/admin-login" />
          </div>
        </header>

        {/* Mobile nav — horizontally-scrollable pills below the top bar. */}
        <nav className="flex gap-1.5 overflow-x-auto border-b border-black/10 bg-surface px-4 py-2.5 lg:hidden dark:border-white/10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {shipAlert && (
          <Link
            href="/fulfillment"
            className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold sm:px-6 lg:px-8 ${
              shipAlert.urgent
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-amber-400 text-black hover:bg-amber-300"
            }`}
          >
            <span>
              {shipAlert.urgent ? "⚠️ " : "🖨️ "}
              {shipAlert.text} — hit the 5-working-day deadline
            </span>
            <span className="shrink-0 underline underline-offset-2">Open queue →</span>
          </Link>
        )}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
