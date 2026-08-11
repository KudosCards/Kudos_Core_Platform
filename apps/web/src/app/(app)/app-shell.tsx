"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icons } from "@/components/icons";
import { Logo } from "@/components/logo";
import { SidebarNav } from "./sidebar-nav";
import { LogoutButton } from "./logout-button";
import { NotificationBell } from "./notification-bell";
import { TutorialsLink } from "@/components/social-links";

/**
 * Header basket: a shopping-cart link to the batch-orders screen, always present
 * so members have a consistent way back into an unfinished purchase. When there
 * are unfinished (draft / pending-payment) orders it lights up with an accent
 * badge (capped at 9+) to nudge them to finish checking out; when there's
 * nothing waiting it's a quiet, muted icon.
 */
function BasketIndicator({ count, onNavigate }: { count: number; onNavigate?: () => void }) {
  const hasItems = count > 0;
  return (
    <Link
      href="/batch-orders"
      onClick={onNavigate}
      aria-label={
        hasItems
          ? `Basket: ${count} unfinished ${count === 1 ? "order" : "orders"}`
          : "Basket — no unfinished orders"
      }
      title={
        hasItems
          ? `${count} unfinished ${count === 1 ? "order" : "orders"} — finish checking out`
          : "Basket — your unfinished orders appear here"
      }
      className={`relative rounded-md p-1.5 hover:bg-foreground/[0.04] ${
        hasItems ? "text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      <Icons.checkout className="size-5" />
      {hasItems && (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}

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
  unfinishedOrders,
  walletLabel,
  children,
}: {
  accountName: string;
  planLabel: string;
  pendingApprovals: number;
  unfinishedOrders: number;
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
        <Link href="/dashboard" onClick={() => setDrawerOpen(false)} className="px-3">
          <Logo className="h-11 w-auto" priority />
          <p className="mt-1 text-xs text-muted">Recognition, delivered</p>
        </Link>
        <SidebarNav pendingApprovals={pendingApprovals} onNavigate={() => setDrawerOpen(false)} />
      </div>
      <div className="mt-6 flex flex-col gap-2 border-t border-border px-3 pt-4">
        <span className="truncate text-sm font-semibold">{accountName}</span>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="truncate">{planLabel}</span>
          <span aria-hidden>·</span>
          <Link href="/settings" className="text-accent hover:underline">
            manage
          </Link>
        </div>
        {/* Our how-to videos live on YouTube — surface them where members work. */}
        <TutorialsLink
          className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
          onClick={() => setDrawerOpen(false)}
        />
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
        {/* Mobile top bar — sticky so page content scrolls under an opaque bar,
            not under the phone's status bar; safe-area padding clears the notch. */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-foreground hover:bg-foreground/[0.04]"
          >
            <Icons.menu className="size-6" />
          </button>
          <Link href="/dashboard" aria-label="Kudos Cards home">
            <Logo className="h-8 w-auto" priority />
          </Link>
          <div className="flex items-center gap-1">
            <BasketIndicator count={unfinishedOrders} />
            <NotificationBell />
            <Link href="/send" className="btn-accent px-3 py-1.5 text-xs">
              Send
            </Link>
          </div>
        </header>

        {/* Desktop top bar */}
        <header className="hidden items-center justify-end gap-4 border-b border-border bg-surface px-8 py-3.5 lg:flex">
          <Link
            href="/wallet"
            className="text-sm text-muted hover:text-foreground"
            title="Wallet balance"
          >
            Wallet: <span className="font-semibold text-foreground">{walletLabel}</span>
          </Link>
          <BasketIndicator count={unfinishedOrders} />
          <NotificationBell />
          <Link href="/send" className="btn-accent">
            Send a card <span aria-hidden>→</span>
          </Link>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
