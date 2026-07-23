"use client";

import type { NotificationFeed, NotificationItem } from "@kudos/shared-types";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icons } from "@/components/icons";
import { clientApiFetch } from "@/lib/api.client";

const KIND_DOT: Record<string, string> = {
  pending_approval: "bg-accent",
  unpaid_order: "bg-accent",
  pending_invite: "bg-blue-500",
  upcoming_occasion: "bg-emerald-500",
};

/**
 * The notification centre — a header bell that opens a "quick view" of things
 * worth knowing: approvals waiting, upcoming events, orders to pay, invites
 * pending. The feed is computed live server-side (GET /notifications), so it's
 * always current. See docs/adr/0030-settings-and-notification-centre.md.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fetch the feed, landing setState in a .then callback (not synchronously in
  // an effect body), matching the async-fetch-in-effect pattern used elsewhere.
  function fetchFeed(): () => void {
    let active = true;
    clientApiFetch<NotificationFeed>("/notifications")
      .then((feed) => {
        if (!active) return;
        setItems(feed.items);
        setError(false);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }

  // Load once on mount for the badge…
  useEffect(() => fetchFeed(), []);
  // …and refresh whenever the panel is opened.
  useEffect(() => {
    if (!open) return;
    return fetchFeed();
  }, [open]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = items?.length ?? 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${count > 0 ? ` (${count})` : ""}`}
        aria-expanded={open}
        className="relative rounded-md p-2 text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground"
      >
        <Icons.bell className="size-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {count > 0 && <span className="text-xs text-muted">{count} to review</span>}
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {error ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Couldn&apos;t load notifications.
              </p>
            ) : items === null ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                You&apos;re all caught up. 🎉
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 hover:bg-foreground/[0.03]"
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${KIND_DOT[item.kind] ?? "bg-muted"}`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        <span className="block text-xs text-muted">{item.body}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            href="/calendar"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-accent hover:bg-foreground/[0.03]"
          >
            View calendar →
          </Link>
        </div>
      )}
    </div>
  );
}
