"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  SupportMessage,
  SupportTicketOpsDetail,
  SupportTicketPriority,
  SupportTicketStatus,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_CLASSES,
  SUPPORT_STATUS_LABELS_OPS,
  formatSupportDate,
  ticketRef,
} from "@/lib/support";
import { SupportAttachmentList } from "@/components/support-attachments";

const inputClass = "rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15";
const controlBtn =
  "rounded-md border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5";

const STATUS_OPTIONS: SupportTicketStatus[] = ["open", "awaiting_customer", "resolved", "closed"];
const PRIORITY_OPTIONS: SupportTicketPriority[] = ["low", "normal", "high", "urgent"];

/** One message in the ops thread. Support replies sit right, customer messages
 * left. Internal notes get a distinct dashed amber card and never look like a
 * sent reply. */
function OpsMessage({ message }: { message: SupportMessage }) {
  if (message.internalNote) {
    return (
      <div className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/[0.06] px-4 py-2.5">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          Internal note · {formatSupportDate(message.createdAt)}
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground/80">{message.body}</p>
      </div>
    );
  }
  const fromSupport = message.authorType === "support";
  return (
    <div className={`flex flex-col gap-1 ${fromSupport ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
          fromSupport ? "bg-accent text-white" : "bg-black/[0.05] text-foreground dark:bg-white/[0.08]"
        }`}
      >
        {message.body}
      </div>
      {message.attachments.length > 0 && (
        <div className={fromSupport ? "flex justify-end" : ""}>
          <SupportAttachmentList attachments={message.attachments} />
        </div>
      )}
      <span className="px-1 text-[11px] text-foreground/50">
        {fromSupport ? "Support" : "Customer"} · {formatSupportDate(message.createdAt)}
      </span>
    </div>
  );
}

export function OpsSupportThreadClient({ ticket }: { ticket: SupportTicketOpsDetail }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setError(null);
    setPending(true);
    try {
      await clientApiFetch(`/admin/support/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      router.refresh();
    } catch (patchError) {
      setError(patchError instanceof ApiError ? patchError.message : "Could not update the ticket");
    } finally {
      setPending(false);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    setPending(true);
    try {
      await clientApiFetch(`/admin/support/${ticket.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim(), internalNote }),
      });
      setBody("");
      setInternalNote(false);
      router.refresh();
    } catch (replyError) {
      setError(replyError instanceof ApiError ? replyError.message : "Could not send the reply");
    } finally {
      setPending(false);
    }
  }

  const closed = ticket.status === "closed";

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* Thread */}
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${SUPPORT_STATUS_CLASSES[ticket.status]}`}
            >
              {SUPPORT_STATUS_LABELS_OPS[ticket.status]}
            </span>
          </div>
          <p className="text-sm text-foreground/60">
            {ticketRef(ticket.ticketNumber)} · {ticket.businessName} ·{" "}
            {SUPPORT_CATEGORY_LABELS[ticket.category]} · opened {formatSupportDate(ticket.createdAt)}
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-black/10 p-5 dark:border-white/10">
          {ticket.messages.map((m) => (
            <OpsMessage key={m.id} message={m} />
          ))}
        </div>

        {error && <p className="text-sm text-accent">{error}</p>}

        {closed ? (
          <p className="rounded-xl border border-black/10 p-5 text-center text-sm text-foreground/60 dark:border-white/10">
            This ticket is closed. Reopen it (set the status to Needs reply or Awaiting customer) to
            reply again.
          </p>
        ) : (
          <form
            onSubmit={sendReply}
            className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/10"
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder={internalNote ? "Add a support-only internal note…" : "Reply to the customer…"}
              className={`${inputClass} resize-y`}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground/70">
                <input
                  type="checkbox"
                  checked={internalNote}
                  onChange={(e) => setInternalNote(e.target.checked)}
                />
                Internal note (not sent to the customer)
              </label>
              <button type="submit" className="btn-accent" disabled={pending || !body.trim()}>
                {pending ? "Saving…" : internalNote ? "Add note" : "Send reply"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Manage panel */}
      <aside className="flex w-full flex-col gap-4 rounded-xl border border-black/10 p-5 lg:w-72 lg:shrink-0 dark:border-white/10">
        <h2 className="text-sm font-semibold">Manage</h2>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/60">Status</span>
          <select
            value={ticket.status}
            onChange={(e) => patch({ status: e.target.value })}
            disabled={pending}
            className={inputClass}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SUPPORT_STATUS_LABELS_OPS[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/60">Priority</span>
          <select
            value={ticket.priority}
            onChange={(e) => patch({ priority: e.target.value })}
            disabled={pending}
            className={inputClass}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {SUPPORT_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-foreground/60">Assignee</span>
          <span className="text-foreground/80">{ticket.assignee ?? "Unassigned"}</span>
          <div className="flex gap-2">
            <button
              type="button"
              className={controlBtn}
              onClick={() => patch({ assign: "me" })}
              disabled={pending}
            >
              Assign to me
            </button>
            {ticket.assignee && (
              <button
                type="button"
                className={controlBtn}
                onClick={() => patch({ assign: "none" })}
                disabled={pending}
              >
                Unassign
              </button>
            )}
          </div>
        </div>

        {ticket.diagnostics && (
          <div className="flex flex-col gap-1.5 border-t border-black/10 pt-4 text-sm dark:border-white/10">
            <span className="text-foreground/60">Diagnostics</span>
            <dl className="flex flex-col gap-1.5 text-xs">
              {ticket.diagnostics.pageUrl && (
                <div className="flex flex-col">
                  <dt className="text-foreground/50">From page</dt>
                  <dd className="break-all text-foreground/80">{ticket.diagnostics.pageUrl}</dd>
                </div>
              )}
              {ticket.diagnostics.userAgent && (
                <div className="flex flex-col">
                  <dt className="text-foreground/50">Browser</dt>
                  <dd className="break-words text-foreground/80">{ticket.diagnostics.userAgent}</dd>
                </div>
              )}
              {ticket.diagnostics.viewport && (
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground/50">Viewport</dt>
                  <dd className="text-foreground/80">{ticket.diagnostics.viewport}</dd>
                </div>
              )}
              {ticket.diagnostics.appVersion && (
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground/50">App version</dt>
                  <dd className="text-foreground/80">{ticket.diagnostics.appVersion}</dd>
                </div>
              )}
              {ticket.diagnostics.plan && (
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground/50">Plan</dt>
                  <dd className="text-foreground/80">{ticket.diagnostics.plan}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </aside>
    </div>
  );
}
