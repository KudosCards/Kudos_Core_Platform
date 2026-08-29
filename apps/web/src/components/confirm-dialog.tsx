"use client";

import { Modal } from "./modal";

/**
 * Confirm something that cannot be undone.
 *
 * Deleting a hand-picked list asked `window.confirm` first; removing a smart
 * list asked nothing at all and simply did it, from a button sitting next to
 * "Send to this list". Same weight of action, two different answers. This is
 * the one answer, and it says what survives — deleting a list never deletes
 * the people on it, which is the fear that makes the button frightening.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <div className="text-sm text-muted">{body}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full border border-danger/40 bg-danger-soft px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-50"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
