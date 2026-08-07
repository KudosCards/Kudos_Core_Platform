"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  VIDEO_PROVIDER_LABELS,
  type MessagePageAccountInsights,
  type MessagePageStatus,
  type MessagePageSummary,
} from "@kudos/shared-types";
import { FunnelBar } from "./funnel-bar";

type SortKey = "recent" | "views" | "cards";
type StatusFilter = "active" | "archived" | "all";

const INPUT = "w-full rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

export function LibraryClient({
  initialPages,
  canAuthor,
  insights,
}: {
  initialPages: MessagePageSummary[];
  canAuthor: boolean;
  insights: MessagePageAccountInsights | null;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [sort, setSort] = useState<SortKey>("recent");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = initialPages.filter((page) => {
      if (status !== "all" && page.status !== (status as MessagePageStatus)) return false;
      if (term && !page.title.toLowerCase().includes(term)) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sort === "views") sorted.sort((a, b) => b.totalViews - a.totalViews);
    else if (sort === "cards") sorted.sort((a, b) => b.linkCount - a.linkCount);
    // "recent" keeps the API's updatedAt-desc order.
    return sorted;
  }, [initialPages, search, status, sort]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Message pages</h1>
          <p className="mt-1 text-sm text-muted">
            Digital pages recipients open by scanning a card&apos;s QR code — a video, a
            written note, a link. Reuse one across many cards, or make a bespoke one.
          </p>
        </div>
        {canAuthor && (
          <Link href="/message-pages/new" className="btn-accent shrink-0">
            New page
          </Link>
        )}
      </header>

      {!canAuthor && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold">Message pages are a Pro feature.</span> Upgrade to
            create video message pages and attach them to your cards.
          </p>
          <Link href="/billing" className="btn-accent shrink-0">
            Upgrade
          </Link>
        </div>
      )}

      {insights && insights.funnel.sent > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <p className="section-label">Engagement across all pages</p>
          <FunnelBar funnel={insights.funnel} />
        </div>
      )}

      {initialPages.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title…"
            className={`${INPUT} max-w-xs`}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className={`${INPUT} w-auto`}
            aria-label="Filter by status"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={`${INPUT} w-auto`}
            aria-label="Sort"
          >
            <option value="recent">Most recent</option>
            <option value="views">Most viewed</option>
            <option value="cards">Most cards</option>
          </select>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState hasAny={initialPages.length > 0} canAuthor={canAuthor} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((page) => (
            <li key={page.id}>
              <Link
                href={`/message-pages/${page.id}`}
                className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/50"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xl">
                    {page.emoji ?? "💌"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{page.title}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {page.status === "archived" && <Badge tone="muted">Archived</Badge>}
                      {page.unreadReplies > 0 && (
                        <Badge tone="new">
                          {page.unreadReplies} new {page.unreadReplies === 1 ? "reply" : "replies"}
                        </Badge>
                      )}
                      {page.videoProvider && (
                        <Badge>{VIDEO_PROVIDER_LABELS[page.videoProvider]}</Badge>
                      )}
                      {page.hasCta && <Badge>Button</Badge>}
                      {page.allowReplies && <Badge>Replies</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-4 text-xs text-muted">
                  <span>
                    {page.linkCount} {page.linkCount === 1 ? "card" : "cards"}
                  </span>
                  <span>
                    {page.totalViews} {page.totalViews === 1 ? "view" : "views"}
                  </span>
                  {page.totalCtaClicks > 0 && (
                    <span>
                      {page.totalCtaClicks} {page.totalCtaClicks === 1 ? "click" : "clicks"}
                    </span>
                  )}
                  {page.replyCount > 0 && (
                    <span>
                      {page.replyCount} {page.replyCount === 1 ? "reply" : "replies"}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({
  children,
  tone = "accent",
}: {
  children: React.ReactNode;
  tone?: "accent" | "muted" | "new";
}) {
  const toneClass =
    tone === "muted"
      ? "bg-foreground/[0.06] text-muted"
      : tone === "new"
        ? "bg-success/15 text-success"
        : "bg-accent-soft text-accent";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function EmptyState({ hasAny, canAuthor }: { hasAny: boolean; canAuthor: boolean }) {
  if (hasAny) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
        No pages match your filters.
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
      <div className="text-4xl">💌</div>
      <p className="text-lg font-semibold">No message pages yet</p>
      <p className="max-w-sm text-sm text-muted">
        Create a page with a video and a personal message, then attach it to a card&apos;s QR
        code when you send.
      </p>
      {canAuthor && (
        <Link href="/message-pages/new" className="btn-accent mt-2">
          Create your first page
        </Link>
      )}
    </div>
  );
}
