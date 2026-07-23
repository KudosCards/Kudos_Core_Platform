import { redirect } from "next/navigation";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { LogoutButton } from "../(app)/logout-button";

/**
 * The internal ops shell — a separate surface from the customer app. Gated on
 * platform-admin status (GET /fulfillment/me), NOT account membership, so ops
 * staff without a tuition-centre account aren't bounced to onboarding. See
 * docs/adr/0010-phase-5-fulfillment-ops.md.
 */
export default async function OpsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const result = await serverApiFetch<{ userId: string }>("/fulfillment/me").catch(
    (error: unknown) => {
      // 403 = authenticated but not a platform operator — send them to the
      // customer app rather than showing an ops surface they can't use.
      if (error instanceof ApiError && error.status === 403) {
        redirect("/dashboard");
      }
      throw error;
    },
  );
  if (!result) {
    redirect("/login");
  }

  const navItems = [
    { href: "/admin", label: "Dashboard", group: "Overview" },
    { href: "/admin/orders", label: "Orders", group: "Overview" },
    { href: "/admin/subscribers", label: "Subscribers", group: "Overview" },
    { href: "/fulfillment", label: "Fulfillment queue", group: "Operations" },
    { href: "/catalog", label: "Card catalog", group: "Operations" },
  ];
  const groups = ["Overview", "Operations"];

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
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile top bar: brand row + horizontally-scrollable nav pills. */}
      <div className="flex flex-col border-b border-black/10 bg-surface lg:hidden dark:border-white/10">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">Kudos Ops</span>
          <LogoutButton />
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
