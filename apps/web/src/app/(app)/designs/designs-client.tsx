"use client";

import type { CardDesign, SavedDesign } from "@kudos/shared-types";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

const ALL_CATEGORIES = "all";

/** "well done" -> "Well done", "birthday" -> "Birthday". */
function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function DesignsClient({
  templates,
  initialSavedDesigns,
}: {
  templates: CardDesign[];
  initialSavedDesigns: SavedDesign[];
}) {
  const router = useRouter();
  const [savedDesigns, setSavedDesigns] = useState(initialSavedDesigns);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [pendingDesignId, setPendingDesignId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  // Sorted unique categories present in the catalog, so a full library stays
  // browsable instead of one long ungrouped grid. Filtering is client-side —
  // the page already has every template, so it's instant and needs no refetch.
  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [templates],
  );
  const visibleTemplates = useMemo(
    () =>
      category === ALL_CATEGORIES ? templates : templates.filter((t) => t.category === category),
    [templates, category],
  );

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

  async function renameDesign(design: SavedDesign) {
    const name = window.prompt("Rename design", design.name)?.trim();
    if (!name || name === design.name) return;
    setError(null);
    setPendingDesignId(design.id);
    try {
      const updated = await clientApiFetch<SavedDesign>(`/saved-designs/${design.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setSavedDesigns((current) => current.map((d) => (d.id === design.id ? updated : d)));
    } catch (renameError) {
      setError(renameError instanceof ApiError ? renameError.message : "Could not rename the design");
    } finally {
      setPendingDesignId(null);
    }
  }

  async function deleteDesign(design: SavedDesign) {
    if (!window.confirm(`Delete "${design.name}"? This can't be undone.`)) return;
    setError(null);
    setPendingDesignId(design.id);
    try {
      await clientApiFetch(`/saved-designs/${design.id}`, { method: "DELETE" });
      setSavedDesigns((current) => current.filter((d) => d.id !== design.id));
    } catch (deleteError) {
      // A design attached to an occasion/order can't be deleted (the API guards
      // it) — surface that instead of silently doing nothing.
      setError(deleteError instanceof ApiError ? deleteError.message : "Could not delete the design");
    } finally {
      setPendingDesignId(null);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Designs</h1>
        <p className="text-muted">Start from a template, then personalise it.</p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Templates</h2>

        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2 text-sm">
            {[ALL_CATEGORIES, ...categories].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                className={`rounded-full px-3 py-1 ${
                  option === category
                    ? "bg-accent text-white"
                    : "border border-border bg-surface hover:bg-foreground/[0.03]"
                }`}
              >
                {option === ALL_CATEGORIES ? "All" : formatCategory(option)}
              </button>
            ))}
          </div>
        )}

        {visibleTemplates.length === 0 ? (
          <div className="card p-8 text-center text-sm text-muted">
            No templates in this category yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleTemplates.map((template) => (
              <div key={template.id} className="card flex flex-col gap-2 p-3">
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-foreground/5">
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
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {creatingTemplateId === template.id ? "Creating…" : "Use this template"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">My designs</h2>
        {savedDesigns.length === 0 ? (
          <div className="card p-8 text-center text-sm text-muted">
            No saved designs yet — start from a template above.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {savedDesigns.map((design) => (
              <div key={design.id} className="card flex flex-col gap-2 p-3">
                <a
                  href={`/designs/${design.id}/edit`}
                  className="flex aspect-[3/4] w-full items-center justify-center rounded-md bg-foreground/5 text-xs text-muted transition-colors hover:bg-foreground/10"
                >
                  Edit
                </a>
                <span className="text-sm font-medium">{design.name}</span>
                <div className="flex items-center gap-1.5 text-xs">
                  <a
                    href={`/designs/${design.id}/edit`}
                    className="rounded-md border border-border px-2 py-1 hover:bg-foreground/[0.03]"
                  >
                    Edit
                  </a>
                  <button
                    type="button"
                    disabled={pendingDesignId === design.id}
                    onClick={() => void renameDesign(design)}
                    className="rounded-md border border-border px-2 py-1 hover:bg-foreground/[0.03] disabled:opacity-40"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={pendingDesignId === design.id}
                    onClick={() => void deleteDesign(design)}
                    className="rounded-md border border-border px-2 py-1 text-accent hover:bg-accent-soft disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
