"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons, type IconName } from "@/components/icons";

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { title: "Overview", items: [{ label: "Dashboard", href: "/dashboard", icon: "dashboard" }] },
  {
    title: "Send cards",
    items: [
      { label: "Bulk send", href: "/send", icon: "send" },
      { label: "Calendar", href: "/calendar", icon: "calendar" },
      { label: "Approvals", href: "/approvals", icon: "approvals" },
      { label: "Checkout", href: "/batch-orders", icon: "checkout" },
      { label: "Orders", href: "/orders", icon: "orders" },
    ],
  },
  {
    title: "Grow relationships",
    items: [
      { label: "Recipients", href: "/recipients", icon: "recipients" },
      { label: "Integrations", href: "/integrations", icon: "integrations" },
      { label: "Designs", href: "/designs", icon: "designs" },
      { label: "Messages", href: "/messages", icon: "messages" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Wallet", href: "/wallet", icon: "wallet" },
      { label: "Billing", href: "/billing", icon: "billing" },
    ],
  },
];

export function SidebarNav({
  pendingApprovals = 0,
  onNavigate,
}: {
  pendingApprovals?: number;
  /** Called when a nav link is clicked — lets the mobile drawer close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="section-label px-3 pb-1">{group.title}</p>
          {group.items.map((item) => {
            const Icon = Icons[item.icon];
            const active = isActive(item.href);
            const badge = item.href === "/approvals" ? pendingApprovals : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"
                }`}
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
