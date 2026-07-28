"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SupportTicketCategory, SupportTicketDetail } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/support";

const CATEGORY_OPTIONS = Object.entries(SUPPORT_CATEGORY_LABELS) as [
  SupportTicketCategory,
  string,
][];

const inputClass = "rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

/** The "raise a ticket" form, shown above the ticket list. On success it routes
 * straight into the new ticket's thread. Collapsed to a button until opened, so
 * the list stays the focus for returning users. */
export function NewTicketForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>("other");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await clientApiFetch<SupportTicketDetail>("/support", {
        method: "POST",
        body: JSON.stringify({ subject: subject.trim(), category, message: message.trim() }),
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
        <label htmlFor="support-message" className="text-sm font-medium">
          How can we help?
        </label>
        <textarea
          id="support-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={1}
          maxLength={5000}
          rows={5}
          placeholder="Tell us what's going on — include order numbers or dates if they help."
          className={`${inputClass} resize-y`}
        />
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-accent" disabled={submitting}>
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
