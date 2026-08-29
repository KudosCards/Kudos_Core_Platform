"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "./modal";

/**
 * Ask for a name — the app's replacement for `window.prompt`.
 *
 * Naming a list used to open the browser's own grey dialog. It is unstyled and
 * unthemed, it sits outside the page on mobile as a system sheet, it cannot say
 * what the name is for, and it has nowhere to put an error: a duplicate name
 * came back as a red banner at the top of the page, after the dialog had
 * already closed and the typed name was gone.
 *
 * This keeps the name in the field when the save fails, so the fix is to edit a
 * word rather than to start again.
 */
export function NameDialog({
  open,
  title,
  label,
  hint,
  initialValue = "",
  confirmLabel = "Save",
  busy = false,
  error = null,
  maxLength = 120,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  /** Optional line under the field — what this name will be used for. */
  hint?: string;
  initialValue?: string;
  confirmLabel?: string;
  busy?: boolean;
  /** Server-side rejection (e.g. a duplicate name), shown against the field. */
  error?: string | null;
  maxLength?: number;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  // Re-seed on each open, so renaming a second list doesn't start from the
  // first one's name and a cancelled edit doesn't come back next time. Done by
  // adjusting state during render off an open/closed transition rather than in
  // an effect: the effect version renders once with the stale name first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(initialValue);
  }

  const trimmed = value.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* The message is a sibling of the label, not a child of it: inside,
            it joins the field's accessible name ("List name You already have a
            list with that name") and is then read a second time through
            aria-describedby. */}
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{label}</span>
            <input
              autoFocus
              value={value}
              maxLength={maxLength}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "name-dialog-error" : hint ? "name-dialog-hint" : undefined}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
          </label>
          {error ? (
            <span id="name-dialog-error" className="text-xs text-danger">
              {error}
            </span>
          ) : hint ? (
            <span id="name-dialog-hint" className="text-xs text-muted">
              {hint}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!trimmed || busy}
            className="btn-accent disabled:opacity-50"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
