"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type {
  SupportAttachmentInput,
  SupportMessage,
  SupportTicketDetail,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_CLASSES,
  SUPPORT_STATUS_LABELS,
  formatSupportDate,
  ticketRef,
} from "@/lib/support";
import { SupportAttachmentsInput, SupportAttachmentList } from "@/components/support-attachments";

const inputClass = "rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

/** One message bubble. The customer's own messages sit on the right; support's
 * replies on the left — the familiar chat convention. */
function MessageBubble({ message }: { message: SupportMessage }) {
  const mine = message.authorType === "customer";
  return (
    <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
          mine ? "bg-accent text-white" : "bg-foreground/[0.05] text-foreground"
        }`}
      >
        {message.body}
      </div>
      {message.attachments.length > 0 && (
        <div className={mine ? "flex justify-end" : ""}>
          <SupportAttachmentList attachments={message.attachments} />
        </div>
      )}
      <span className="px-1 text-[11px] text-muted">
        {mine ? "You" : "Kudos Support"} · {formatSupportDate(message.createdAt)}
      </span>
    </div>
  );
}

export function SupportThreadClient({ ticket }: { ticket: SupportTicketDetail }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachmentInput[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"reply" | "close" | null>(null);

  const closed = ticket.status === "closed";

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    setPending("reply");
    try {
      await clientApiFetch(`/support/${ticket.id}/reply`, {
        method: "POST",
        body: JSON.stringify({
          body: body.trim(),
          ...(attachments.length > 0 && { attachments }),
        }),
      });
      setBody("");
      setAttachments([]);
      router.refresh();
    } catch (replyError) {
      setError(replyError instanceof ApiError ? replyError.message : "Could not send your reply");
    } finally {
      setPending(null);
    }
  }

  async function closeTicket() {
    setError(null);
    setPending("close");
    try {
      await clientApiFetch(`/support/${ticket.id}/close`, { method: "POST" });
      router.refresh();
    } catch (closeError) {
      setError(closeError instanceof ApiError ? closeError.message : "Could not close the ticket");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${SUPPORT_STATUS_CLASSES[ticket.status]}`}
          >
            {SUPPORT_STATUS_LABELS[ticket.status]}
          </span>
        </div>
        <p className="text-sm text-muted">
          {ticketRef(ticket.ticketNumber)} · {SUPPORT_CATEGORY_LABELS[ticket.category]} · opened{" "}
          {formatSupportDate(ticket.createdAt)}
        </p>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        {ticket.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}

      {closed ? (
        <div className="card p-5 text-center text-sm text-muted">
          This ticket is closed. Need more help?{" "}
          <Link href="/support" className="text-accent hover:underline">
            Raise a new ticket
          </Link>
          .
        </div>
      ) : (
        <form onSubmit={sendReply} className="card flex flex-col gap-3 p-5">
          <label htmlFor="support-reply" className="text-sm font-medium">
            Reply
          </label>
          <textarea
            id="support-reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Type your reply…"
            className={`${inputClass} resize-y`}
          />
          <SupportAttachmentsInput
            value={attachments}
            onChange={setAttachments}
            onBusyChange={setUploadBusy}
            disabled={pending !== null}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="btn-accent"
              disabled={pending !== null || uploadBusy || !body.trim()}
            >
              {pending === "reply" ? "Sending…" : "Send reply"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={closeTicket}
              disabled={pending !== null}
            >
              {pending === "close" ? "Closing…" : "Close ticket"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
