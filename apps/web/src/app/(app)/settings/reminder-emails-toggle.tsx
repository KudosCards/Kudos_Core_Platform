"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** The reminder-emails opt-out, shared conceptually with the notification
 * centre — one lives in the inbox, one in-app. */
export function ReminderEmailsToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError(null);
    try {
      await clientApiFetch("/accounts/me/notifications", {
        method: "PATCH",
        body: JSON.stringify({ reminderEmailsEnabled: next }),
      });
    } catch (toggleError) {
      setEnabled(!next);
      setError(toggleError instanceof ApiError ? toggleError.message : "Could not update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Upcoming-birthday reminder emails</p>
        <p className="text-xs text-muted">
          A weekly heads-up when recipients have birthdays coming up.
        </p>
        {error && <p className="mt-1 text-xs font-medium text-accent">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={saving}
        onClick={() => void toggle()}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          enabled ? "bg-accent" : "bg-foreground/20"
        }`}
      >
        <span
          className={`inline-block size-5 transform rounded-full bg-white transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
