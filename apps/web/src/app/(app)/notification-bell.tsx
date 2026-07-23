"use client";

import type {
  InboxNotification,
  InboxPage,
  NotificationFeed,
  NotificationItem,
} from "@kudos/shared-types";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icons } from "@/components/icons";
import { clientApiFetch } from "@/lib/api.client";

const KIND_DOT: Record<string, string> = {
  pending_approval: "bg-accent",
  unpaid_order: "bg-accent",
  pending_invite: "bg-blue-500",
  upcoming_occasion: "bg-emerald-500",
  order_paid: "bg-emerald-500",
  auto_send: "bg-blue-500",
  invite_accepted: "bg-blue-500",
};

/** A short "2h ago" / "3d ago" relative time for inbox rows. */
function timeAgo(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The notification centre — a header bell with two parts:
 *  • "Needs action" — the computed feed (GET /notifications), live from account
 *    state, no read/unread. See ADR 0030.
 *  • "Recent" — the persisted inbox (GET /notifications/inbox), a per-user
 *    history of things that happened, each with read/unread. See ADR 0034.
 * The badge counts unread inbox items — the genuinely "new" things — while the
 * action items are ever-present todos surfaced below.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [feed, setFeed] = useState<NotificationItem[] | null>(null);
  const [inbox, setInbox] = useState<InboxNotification[] | null>(null);
  const [error, setError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // On mount, just the badge count — cheap enough to load on every page.
  function fetchUnread(): () => void {
    let active = true;
    clientApiFetch<{ unreadCount: number }>("/notifications/inbox/unread-count")
      .then((res) => {
        if (active) setUnread(res.unreadCount);
      })
      .catch(() => {
        /* a badge that fails to load is not worth surfacing */
      });
    return () => {
      active = false;
    };
  }

  // On open, both the action feed and the inbox page.
  function fetchAll(): () => void {
    let active = true;
    Promise.all([
      clientApiFetch<NotificationFeed>("/notifications"),
      clientApiFetch<InboxPage>("/notifications/inbox"),
    ])
      .then(([feedRes, inboxRes]) => {
        if (!active) return;
        setFeed(feedRes.items);
        // Dates arrive as JSON strings — coerce to Date for timeAgo/read checks.
        setInbox(
          inboxRes.items.map((i) => ({
            ...i,
            readAt: i.readAt ? new Date(i.readAt) : null,
            createdAt: new Date(i.createdAt),
          })),
        );
        setUnread(inboxRes.unreadCount);
        setError(false);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }

  useEffect(() => fetchUnread(), []);
  useEffect(() => {
    if (!open) return;
    return fetchAll();
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

  function markRead(id: string): void {
    setInbox((current) =>
      current
        ? current.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date() } : n))
        : current,
    );
    setUnread((n) => Math.max(0, n - 1));
    void clientApiFetch(`/notifications/inbox/${id}/read`, { method: "POST" }).catch(() => {
      /* best-effort; the next open re-syncs true state */
    });
  }

  function markAllRead(): void {
    setInbox((current) => (current ? current.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })) : current));
    setUnread(0);
    void clientApiFetch("/notifications/inbox/read-all", { method: "POST" }).catch(() => {});
  }

  const feedCount = feed?.length ?? 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className="relative rounded-md p-2 text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground"
      >
        <Icons.bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[24rem] overflow-y-auto">
            {error ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Couldn&apos;t load notifications.
              </p>
            ) : feed === null || inbox === null ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
            ) : feedCount === 0 && inbox.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                You&apos;re all caught up. 🎉
              </p>
            ) : (
              <>
                {feedCount > 0 && (
                  <section>
                    <h3 className="bg-foreground/[0.02] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Needs action
                    </h3>
                    <ul className="divide-y divide-border">
                      {feed.map((item) => (
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
                  </section>
                )}

                {inbox.length > 0 && (
                  <section>
                    <h3 className="bg-foreground/[0.02] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Recent
                    </h3>
                    <ul className="divide-y divide-border">
                      {inbox.map((item) => {
                        const unreadRow = !item.readAt;
                        const row = (
                          <span className="flex flex-1 gap-3">
                            <span
                              aria-hidden
                              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                                unreadRow ? (KIND_DOT[item.kind] ?? "bg-accent") : "bg-transparent"
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-sm ${
                                  unreadRow ? "font-semibold text-foreground" : "font-medium text-foreground/70"
                                }`}
                              >
                                {item.title}
                              </span>
                              <span className="block text-xs text-muted">{item.body}</span>
                              <span className="mt-0.5 block text-[11px] text-muted/70">
                                {timeAgo(item.createdAt)}
                              </span>
                            </span>
                          </span>
                        );
                        return (
                          <li
                            key={item.id}
                            className={`flex px-4 py-3 hover:bg-foreground/[0.03] ${unreadRow ? "bg-accent/[0.03]" : ""}`}
                          >
                            {item.href ? (
                              <Link
                                href={item.href}
                                onClick={() => {
                                  markRead(item.id);
                                  setOpen(false);
                                }}
                                className="flex flex-1"
                              >
                                {row}
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={() => markRead(item.id)}
                                className="flex flex-1 text-left"
                              >
                                {row}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </>
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
