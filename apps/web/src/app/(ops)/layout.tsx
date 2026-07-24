import { redirect } from "next/navigation";
import Link from "next/link";
import type { AdminIdentity } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { LogoutButton } from "../(app)/logout-button";

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

  const navItems = [
    { href: "/admin", label: "Dashboard", group: "Overview" },
    { href: "/admin/orders", label: "Orders", group: "Overview" },
    { href: "/admin/subscribers", label: "Subscribers", group: "Overview" },
    { href: "/fulfillment", label: "Fulfillment queue", group: "Operations" },
    { href: "/admin/returns", label: "Returned to sender", group: "Operations" },
    { href: "/catalog", label: "Card catalog", group: "Operations" },
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
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col justify-between border-r border-black/10 px-4 py-6 lg:flex dark:border-white/10">
        <div className="flex flex-col gap-2 text-sm font-medium">
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
        <div className="flex flex-col gap-2 border-t border-black/10 pt-4 text-sm dark:border-white/10">
          <div className="px-3">
            <p className="truncate text-xs font-medium text-foreground/80" title={me.email ?? undefined}>
              {me.email ?? "Operator"}
            </p>
            <p className="text-xs text-foreground/40">
              {me.role === "super_admin" ? "Super admin" : "Operator"}
            </p>
          </div>
          <LogoutButton redirectTo="/admin-login" />
        </div>
      </aside>

      {/* Mobile top bar: brand row + horizontally-scrollable nav pills. */}
      <div className="flex flex-col border-b border-black/10 bg-surface lg:hidden dark:border-white/10">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">Kudos Ops</span>
          <LogoutButton redirectTo="/admin-login" />
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      </div>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
