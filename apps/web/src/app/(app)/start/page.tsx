"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CardDesign, SavedDesign } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { clearPendingCardId, readPendingCardId } from "@/lib/pending-card";

/**
 * The landing point after signing up via "Personalise this card". It reads the
 * card the visitor chose while logged out (localStorage, or ?card= as a
 * fallback), turns it into a saved design, and drops them into the editor — the
 * personalise payoff. With nothing pending it just forwards to the dashboard.
 * See docs/adr/0017-public-card-library.md.
 */
export default function StartPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // StrictMode double-invokes effects in dev; guard so we don't create two designs.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const paramCard = new URLSearchParams(window.location.search).get("card");
    const cardId = readPendingCardId() ?? paramCard;

    if (!cardId) {
      router.replace("/dashboard");
      return;
    }

    void (async () => {
      try {
        // Name the design after the template (best-effort — fall back to a
        // generic name if the lookup fails).
        let name = "Personalised card";
        try {
          const card = await clientApiFetch<CardDesign>(`/card-designs/${cardId}`);
          name = card.name;
        } catch {
          /* keep the fallback name */
        }

        const created = await clientApiFetch<SavedDesign>("/saved-designs", {
          method: "POST",
          body: JSON.stringify({ cardDesignId: cardId, name }),
        });
        clearPendingCardId();
        router.replace(`/designs/${created.id}/edit`);
      } catch (startError) {
        clearPendingCardId();
        setError(
          startError instanceof ApiError
            ? startError.message
            : "We couldn't open that card — pick one from your designs to get started.",
        );
      }
    })();
  }, [router]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      {error ? (
        <>
          <p className="text-sm font-medium text-accent">{error}</p>
          <Link href="/designs" className="btn-accent">
            Go to designs
          </Link>
        </>
      ) : (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          <p className="text-muted">Setting up your card…</p>
        </>
      )}
    </div>
  );
}
