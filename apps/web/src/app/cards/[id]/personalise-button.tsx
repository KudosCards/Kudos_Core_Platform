"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SavedDesign } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";
import { setPendingCardId } from "@/lib/pending-card";

const CORAL = "#ef5b52";

/**
 * The paywall CTA. A logged-out visitor is sent into sign-up carrying their
 * chosen card (localStorage + ?card= param); an already-signed-in visitor skips
 * straight to the editor with a fresh saved design. See
 * docs/adr/0017-public-card-library.md.
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
        // Not signed in — remember the card and route into sign-up. /start
        // consumes it once they're authenticated.
        setPendingCardId(cardId);
        router.push(`/register?card=${cardId}`);
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
