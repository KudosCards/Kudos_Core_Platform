"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

/**
 * The settings "Danger zone". Deleting an account is irreversible — it cancels
 * any subscription, removes every contact/order/design, and signs everyone out
 * — so it's gated behind an explicit expand + a typed-name confirmation that must
 * match exactly before the button enables. Rendered only for the account owner
 * (the server page checks the role); the API enforces owner-only too.
 */
export function DeleteAccountSection({ accountName }: { accountName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmName.trim() === accountName.trim() && !pending;

  async function handleDelete() {
    if (!canDelete) return;
    setError(null);
    setPending(true);
    try {
      await clientApiFetch("/accounts/me", {
        method: "DELETE",
        body: JSON.stringify({ confirmName: confirmName.trim() }),
      });
      // Account (and this login's membership) is gone — sign out and leave.
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof ApiError
          ? deleteError.message
          : "Could not delete the account. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-red-600 dark:text-red-400">Danger zone</h2>
      <div className="card flex flex-col gap-4 border-red-500/30 p-5">
        <div className="flex flex-col gap-1">
          <p className="font-medium">Delete this account</p>
          <p className="text-sm text-muted">
            Permanently removes your contacts, designs, orders, and team, and cancels any
            subscription. This can&apos;t be undone.
          </p>
        </div>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="self-start rounded-md border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            Delete account
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">
                Type <span className="font-semibold text-foreground">{accountName}</span> to confirm.
              </span>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
                placeholder={accountName}
                className="w-full max-w-sm rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-red-500"
              />
            </label>

            {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canDelete}
                onClick={() => void handleDelete()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? "Deleting…" : "Permanently delete account"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setConfirmName("");
                  setError(null);
                }}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03] disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
