"use client";

import { useEffect, useState } from "react";
import type { MessagePageReply } from "@kudos/shared-types";
import { clientApiFetch } from "@/lib/api.client";

/**
 * The replies a page has received (Phase 2, ADR 0132). Fetched on mount, and
 * opening the panel marks any unread ones read (so the library badge clears).
 * Bodies are plain text rendered as text — never HTML.
 */
export function RepliesPanel({ pageId }: { pageId: string }) {
  const [replies, setReplies] = useState<MessagePageReply[] | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await clientApiFetch<MessagePageReply[]>(`/message-pages/${pageId}/replies`);
        if (!active) return;
        setReplies(data);
        if (data.some((reply) => reply.readAt === null)) {
          await clientApiFetch(`/message-pages/${pageId}/replies/read`, { method: "POST" });
        }
      } catch {
        if (active) setReplies([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [pageId]);

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <p className="section-label">Replies{replies ? ` (${replies.length})` : ""}</p>
      {replies === null ? (
        <div className="h-16 animate-pulse rounded-lg bg-foreground/5" />
      ) : replies.length === 0 ? (
        <p className="text-sm text-muted">No replies yet. They&apos;ll appear here when someone writes back.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {replies.map((reply) => (
            <li
              key={reply.id}
              className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {reply.senderName ?? reply.fromRecipientName ?? "Someone"}
                </span>
                {reply.readAt === null && (
                  <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground/80">{reply.body}</p>
              {reply.senderName && reply.fromRecipientName && (
                <span className="text-xs text-muted">via {reply.fromRecipientName}&apos;s card</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
