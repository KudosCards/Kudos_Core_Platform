"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icons } from "@/components/icons";
import { SidebarNav } from "./sidebar-nav";
import { LogoutButton } from "./logout-button";

/**
 * The authenticated app shell. On desktop it's a fixed left sidebar; on
 * mobile the sidebar collapses behind a hamburger and slides in as an overlay
 * drawer, so the nav never eats a phone screen. The server layout fetches the
 * account/summary and passes the display values in.
 */
export function AppShell({
  accountName,
  planLabel,
  pendingApprovals,
  walletLabel,
  children,
}: {
  accountName: string;
  planLabel: string;
  pendingApprovals: number;
  walletLabel: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Nav-link clicks close the drawer via onNavigate; this covers the browser
  // back/forward buttons. (Closing in the popstate handler keeps the setState
  // out of the effect body.)
  useEffect(() => {
    const close = () => setDrawerOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const sidebarInner = (
    <div className="flex h-full flex-col justify-between px-4 py-6">
      <div className="flex flex-col gap-8">
        <div className="px-3">
          <p className="text-lg font-bold tracking-tight">Kudos Cards</p>
          <p className="text-xs text-muted">Recognition, delivered</p>
        </div>
        <SidebarNav pendingApprovals={pendingApprovals} onNavigate={() => setDrawerOpen(false)} />
      </div>
      <div className="mt-6 flex flex-col gap-2 border-t border-border px-3 pt-4">
        <span className="truncate text-sm font-semibold">{accountName}</span>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="truncate">{planLabel}</span>
          <span aria-hidden>·</span>
          <Link href="/billing" className="text-accent hover:underline">
            manage
          </Link>
        </div>
        <div className="pt-1">
          <LogoutButton />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        {sidebarInner}
      </aside>

      {/* Mobile slide-in drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[82%] overflow-y-auto border-r border-border bg-surface shadow-xl">
            <div className="flex justify-end px-3 pt-3">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md p-1.5 text-muted hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <Icons.close className="size-5" />
              </button>
            </div>
            {sidebarInner}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-foreground hover:bg-foreground/[0.04]"
          >
            <Icons.menu className="size-6" />
          </button>
          <span className="font-bold tracking-tight">Kudos Cards</span>
          <Link href="/batch-orders" className="btn-accent px-3 py-1.5 text-xs">
            Order
          </Link>
        </header>

        {/* Desktop top bar */}
        <header className="hidden items-center justify-end gap-4 border-b border-border bg-surface px-8 py-3.5 lg:flex">
          <span className="text-sm text-muted">
            Wallet: <span className="font-semibold text-foreground">{walletLabel}</span>
          </span>
          <Link href="/batch-orders" className="btn-accent">
            Create an order <span aria-hidden>→</span>
          </Link>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
