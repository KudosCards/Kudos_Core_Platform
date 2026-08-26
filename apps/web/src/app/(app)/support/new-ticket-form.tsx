"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  SupportAttachmentInput,
  SupportDiagnostics,
  SupportTicketCategory,
  SupportTicketDetail,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/support";
import { SupportAttachmentsInput } from "@/components/support-attachments";

const CATEGORY_OPTIONS = Object.entries(SUPPORT_CATEGORY_LABELS) as [
  SupportTicketCategory,
  string,
][];

const inputClass = "rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

/** Silently capture best-effort browser context for ops triage. Never blocks
 * submission; unknown/empty fields are dropped, values clamped to the schema. */
function captureDiagnostics(): SupportDiagnostics | undefined {
  if (typeof window === "undefined") return undefined;
  const raw: SupportDiagnostics = {
    // The page the customer came from is usually where the problem is.
    pageUrl: (document.referrer || window.location.href).slice(0, 2000),
    userAgent: navigator.userAgent.slice(0, 500),
    viewport: `${window.innerWidth}x${window.innerHeight}`.slice(0, 30),
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION?.slice(0, 100),
  };
  const entries = Object.entries(raw).filter(([, v]) => v);
  return entries.length > 0 ? (Object.fromEntries(entries) as SupportDiagnostics) : undefined;
}

/**
 * The "raise a ticket" form. Guided prompts help the customer explain the
 * problem clearly, they can attach screenshots/recordings, and we quietly
 * capture technical context for support — all to cut the back-and-forth. See
 * ADR 0079.
 */
export function NewTicketForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>("other");
  const [tryingTo, setTryingTo] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [expected, setExpected] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachmentInput[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Compose the guided fields into a single, well-structured message body. */
  function composeMessage(): string {
    const parts: string[] = [];
    if (tryingTo.trim()) parts.push(`What I was trying to do:\n${tryingTo.trim()}`);
    parts.push(`What happened:\n${whatHappened.trim()}`);
    if (expected.trim()) parts.push(`What I expected:\n${expected.trim()}`);
    return parts.join("\n\n");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const diagnostics = captureDiagnostics();
      const ticket = await clientApiFetch<SupportTicketDetail>("/support", {
        method: "POST",
        body: JSON.stringify({
          subject: subject.trim(),
          category,
          message: composeMessage(),
          ...(attachments.length > 0 && { attachments }),
          ...(diagnostics && { diagnostics }),
        }),
      });
      router.push(`/support/${ticket.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError ? submitError.message : "Could not raise your ticket",
      );
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button type="button" className="btn-accent" onClick={() => setOpen(true)}>
          New support ticket
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="support-subject" className="text-sm font-medium">
          Subject
        </label>
        <input
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          minLength={3}
          maxLength={150}
          placeholder="A short summary of what you need help with"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="support-category" className="text-sm font-medium">
          Category
        </label>
        <select
          id="support-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}
          className={inputClass}
        >
          {CATEGORY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="support-happened" className="text-sm font-medium">
          What happened?
        </label>
        <textarea
          id="support-happened"
          value={whatHappened}
          onChange={(e) => setWhatHappened(e.target.value)}
          required
          minLength={1}
          maxLength={4000}
          rows={4}
          placeholder="Describe the problem — the more specific, the faster we can fix it. Include order numbers or dates if they help."
          className={`${inputClass} resize-y`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="support-trying" className="text-sm font-medium">
            What were you trying to do? <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="support-trying"
            value={tryingTo}
            onChange={(e) => setTryingTo(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. Send birthday cards to my Year 4 list"
            className={`${inputClass} resize-y`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="support-expected" className="text-sm font-medium">
            What did you expect? <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="support-expected"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. The order should have gone through to payment"
            className={`${inputClass} resize-y`}
          />
        </div>
      </div>

      <SupportAttachmentsInput
        value={attachments}
        onChange={setAttachments}
        onBusyChange={setUploadBusy}
        disabled={submitting}
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-accent" disabled={submitting || uploadBusy}>
          {submitting ? "Sending…" : "Send ticket"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(false)}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
