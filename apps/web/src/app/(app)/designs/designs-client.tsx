"use client";

import type { CardDesign, SavedDesign } from "@kudos/shared-types";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

export function DesignsClient({
  templates,
  initialSavedDesigns,
}: {
  templates: CardDesign[];
  initialSavedDesigns: SavedDesign[];
}) {
  const router = useRouter();
  const [savedDesigns] = useState(initialSavedDesigns);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createFromTemplate(template: CardDesign) {
    setError(null);
    setCreatingTemplateId(template.id);
    try {
      const created = await clientApiFetch<SavedDesign>("/saved-designs", {
        method: "POST",
        body: JSON.stringify({ cardDesignId: template.id, name: `${template.name} copy` }),
      });
      router.push(`/designs/${created.id}/edit`);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Could not create a design");
      setCreatingTemplateId(null);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">Designs</h1>
        <p className="text-foreground/60">Start from a template, then personalise it.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Templates</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-black/5 dark:bg-white/5">
                <Image
                  src={template.thumbnailUrl}
                  alt={template.name}
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
              <span className="text-sm font-medium">{template.name}</span>
              <button
                type="button"
                disabled={creatingTemplateId === template.id}
                onClick={() => void createFromTemplate(template)}
                className="rounded-full bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90 disabled:opacity-50"
              >
                {creatingTemplateId === template.id ? "Creating…" : "Use this template"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">My designs</h2>
        {savedDesigns.length === 0 ? (
          <p className="text-sm text-foreground/60">
            No saved designs yet — start from a template above.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {savedDesigns.map((design) => (
              <a
                key={design.id}
                href={`/designs/${design.id}/edit`}
                className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
              >
                <div className="flex aspect-[3/4] w-full items-center justify-center rounded-md bg-black/5 text-xs text-foreground/50 dark:bg-white/5">
                  Edit
                </div>
                <span className="text-sm font-medium">{design.name}</span>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
