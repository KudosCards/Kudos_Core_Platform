"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SavedDesign } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

const CORAL = "#ef5b52";

/**
 * The card CTA. A logged-out visitor goes to the friction-free guest send flow
 * (buy & post one card, no account needed — Moonpig-style); an already-signed-in
 * visitor skips straight to the editor with a fresh saved design. See
 * docs/adr/0025-guest-one-off-purchases-and-account-tiers.md.
 */
export function PersonaliseButton({ cardId, cardName }: { cardId: string; cardName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function personalise() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        // Not signed in — no paywall. Go straight to the guest send flow to
        // personalise, address and buy this one card without an account.
        router.push(`/cards/${cardId}/send`);
        return;
      }

      // Signed in already — create the design and go straight to the editor.
      const created = await clientApiFetch<SavedDesign>("/saved-designs", {
        method: "POST",
        body: JSON.stringify({ cardDesignId: cardId, name: cardName }),
      });
      router.push(`/designs/${created.id}/edit`);
    } catch (personaliseError) {
      setError(
        personaliseError instanceof ApiError
          ? personaliseError.message
          : "Something went wrong — please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void personalise()}
        disabled={busy}
        className="rounded-full px-6 py-3 text-center font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: CORAL }}
      >
        {busy ? "One moment…" : "Personalise this card"}
      </button>
      {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
    </div>
  );
}
