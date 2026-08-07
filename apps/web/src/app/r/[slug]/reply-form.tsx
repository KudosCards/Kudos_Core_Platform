"use client";

import { useState } from "react";
import { MESSAGE_PAGE_LIMITS } from "@kudos/shared-types";
import { env } from "@/lib/env";

const INPUT = "w-full rounded-md border border-border bg-surface px-3 py-2.5 text-base";

/**
 * The reply box on a public message page (Phase 2, ADR 0132). Posts anonymously
 * to the throttled public endpoint; on success it collapses to a thank-you so a
 * recipient can't spam-submit. Plain text only — the API caps length and stores
 * it as text, and the dashboard renders it escaped.
 */
export function ReplyForm({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setState("sending");
    try {
      const response = await fetch(
        `${env.NEXT_PUBLIC_API_URL}/messages/${encodeURIComponent(slug)}/replies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ senderName: name.trim() || null, body: body.trim() }),
        },
      );
      setState(response.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="w-full max-w-md rounded-xl border border-success/30 bg-success/5 px-4 py-5 text-center">
        <p className="text-lg font-semibold">Thank you — your reply has been sent 💌</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-3 text-left">
      <p className="text-center text-sm font-semibold text-muted">Write back</p>
      <input
        type="text"
        value={name}
        maxLength={MESSAGE_PAGE_LIMITS.replySenderName}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name (optional)"
        className={INPUT}
      />
      <textarea
        value={body}
        maxLength={MESSAGE_PAGE_LIMITS.replyBody}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Your message…"
        rows={4}
        required
        className={`${INPUT} resize-y`}
      />
      {state === "error" && (
        <p className="text-sm text-danger">Couldn&apos;t send that — please try again.</p>
      )}
      <button
        type="submit"
        disabled={state === "sending" || !body.trim()}
        className="btn-accent self-center"
      >
        {state === "sending" ? "Sending…" : "Send reply"}
      </button>
    </form>
  );
}
