"use client";

import type { PlatformNotification, PlatformNotificationPage } from "@kudos/shared-types";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icons } from "@/components/icons";
import { clientApiFetch } from "@/lib/api.client";

/** Dot colour per operator-alert kind; falls back to accent.
 *  Red is reserved for "act now" (cards due, an escalation); green is money in;
 *  blue is someone new; slate is the morning digest, which is a report rather
 *  than a prompt. `kind` is an open string on the wire, so an unknown kind still
 *  renders — it just gets the accent dot. */
const KIND_DOT: Record<string, string> = {
  dispatch_reminder: "bg-red-500",
  dispatch_escalation: "bg-red-600",
  new_order: "bg-emerald-500",
  new_signup: "bg-sky-500",
  daily_summary: "bg-slate-400",
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
 * The Kudos HQ ops notification centre — a header bell showing the operator's
 * persisted inbox (read/unread). The platform-admin counterpart of the account
 * NotificationBell; here there's no computed feed, just the inbox. See ADR 0116.
 */
export function OpsNotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [inbox, setInbox] = useState<PlatformNotification[] | null>(null);
  const [error, setError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // On mount, just the badge count — cheap enough for every page.
  useEffect(() => {
    let active = true;
    clientApiFetch<{ unreadCount: number }>("/admin/notifications/unread-count")
      .then((res) => {
        if (active) setUnread(res.unreadCount);
      })
      .catch(() => {
        /* a badge that fails to load is not worth surfacing */
      });
    return () => {
      active = false;
    };
  }, []);

  // On open, the inbox page.
  useEffect(() => {
    if (!open) return;
    let active = true;
    clientApiFetch<PlatformNotificationPage>("/admin/notifications")
      .then((res) => {
        if (!active) return;
        setInbox(
          res.items.map((item) => ({
            ...item,
            readAt: item.readAt ? new Date(item.readAt) : null,
            createdAt: new Date(item.createdAt),
          })),
        );
        setUnread(res.unreadCount);
        setError(false);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
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
    void clientApiFetch(`/admin/notifications/${id}/read`, { method: "POST" }).catch(() => {
      /* best-effort; the next open re-syncs true state */
    });
  }

  function markAllRead(): void {
    setInbox((current) =>
      current ? current.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })) : current,
    );
    setUnread(0);
    void clientApiFetch("/admin/notifications/read-all", { method: "POST" }).catch(() => {});
  }

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
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
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
                Couldn’t load notifications.
              </p>
            ) : inbox === null ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
            ) : inbox.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">You’re all caught up. 🎉</p>
            ) : (
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
                            unreadRow
                              ? "font-semibold text-foreground"
                              : "font-medium text-foreground/70"
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
