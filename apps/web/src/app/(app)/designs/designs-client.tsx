"use client";

import type { CardDesign, DesignDocument, SavedDesign } from "@kudos/shared-types";
import Image from "next/image";
import dynamic from "next/dynamic";
import { CARD_BLUR_DATA_URL, isOptimizableThumbnail } from "@/lib/card-image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

// The read-only Konva renderer that draws a design's front page (artwork + text)
// from its document — the same one bulk-send and fulfillment use. Client-only
// (Konva needs the canvas/window), so it's dynamically imported with ssr: false.
const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/**
 * A saved design has no flat thumbnail image (unlike a catalog template) — only
 * its editable document — so its gallery tile must render that document to show
 * the artwork. This measures the tile's width and hands it to CardFacePreview,
 * which scales the 450×634 card to fit crisply (mirrors the editor canvas's own
 * responsive scaling).
 */
function SavedDesignThumb({ document }: { document: DesignDocument }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full">
      {width > 0 && <CardFacePreview document={document} width={width} />}
    </div>
  );
}

const ALL_CATEGORIES = "all";

// The card canvas is 450×600 (see design-canvas.tsx). Uploaded artwork is placed
// as a single full-bleed image on the front page so it fills the card edge to
// edge; the member can then reposition or add text/QR in the editor.
const CARD_WIDTH = 450;
const CARD_HEIGHT = 600;

const DESIGN_ASSETS_BUCKET = "design-assets";
const ARTWORK_ACCEPT = "image/png,image/jpeg,image/webp";

interface SignedUpload {
  path: string;
  token: string;
  publicUrl: string;
}

/** "well done" -> "Well done", "birthday" -> "Birthday". */
function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** A full-bleed custom design document built around the member's uploaded image. */
function artworkDocument(assetUrl: string) {
  return {
    version: 1 as const,
    pages: [
      {
        name: "front" as const,
        elements: [
          {
            kind: "image" as const,
            id: crypto.randomUUID(),
            assetUrl,
            x: 0,
            y: 0,
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            rotation: 0,
          },
        ],
      },
      { name: "inside-left" as const, elements: [] },
      { name: "inside-right" as const, elements: [] },
      { name: "back" as const, elements: [] },
    ],
  };
}

export function DesignsClient({
  templates,
  initialSavedDesigns,
  customArtworkEnabled,
}: {
  templates: CardDesign[];
  initialSavedDesigns: SavedDesign[];
  customArtworkEnabled: boolean;
}) {
  const router = useRouter();
  const [savedDesigns, setSavedDesigns] = useState(initialSavedDesigns);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [pendingDesignId, setPendingDesignId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const artworkInputRef = useRef<HTMLInputElement>(null);

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

  async function uploadArtwork(file: File) {
    setError(null);
    setUploading(true);
    try {
      // Same signed-upload → Supabase Storage flow the editor uses for images.
      const signed = await clientApiFetch<SignedUpload>("/uploads/design-assets", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(DESIGN_ASSETS_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // Create a custom saved design (no template) from the uploaded artwork,
      // then drop the member straight into the editor to finish it.
      const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "My artwork";
      const created = await clientApiFetch<SavedDesign>("/saved-designs", {
        method: "POST",
        body: JSON.stringify({
          name: baseName.slice(0, 120),
          document: artworkDocument(signed.publicUrl),
        }),
      });
      router.push(`/designs/${created.id}/edit`);
    } catch (uploadCatchError) {
      setError(
        uploadCatchError instanceof ApiError || uploadCatchError instanceof Error
          ? uploadCatchError.message
          : "Could not upload your artwork",
      );
      setUploading(false);
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
      setError(
        renameError instanceof ApiError ? renameError.message : "Could not rename the design",
      );
    } finally {
      setPendingDesignId(null);
    }
  }

  async function deleteDesign(design: SavedDesign) {
    if (!window.confirm(`Delete "${design.name}"? This can't be undone.`)) return;
    setError(null);
    setNotice(null);
    setPendingDesignId(design.id);
    try {
      // The API removes the design if nothing references it, or archives it out
      // of the library if a past order/occasion still points at it (that history
      // can't be broken). Either way it leaves the gallery — reflect which.
      const result = await clientApiFetch<{ archived: boolean }>(
        `/saved-designs/${design.id}`,
        { method: "DELETE" },
      );
      setSavedDesigns((current) => current.filter((d) => d.id !== design.id));
      setNotice(
        result.archived
          ? `“${design.name}” was removed from your library. It's kept on the past orders that used it.`
          : `“${design.name}” was deleted.`,
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof ApiError ? deleteError.message : "Could not delete the design",
      );
    } finally {
      setPendingDesignId(null);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Designs</h1>
        <p className="text-muted">
          Your saved designs live here. Start from a template, or upload your own artwork.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
          {error}
        </p>
      )}

      {notice && (
        <p className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">
          {notice}
        </p>
      )}

      {/* My designs, front and centre — this is what members come back to. */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">My designs</h2>
          {customArtworkEnabled ? (
            <>
              <button
                type="button"
                disabled={uploading}
                onClick={() => artworkInputRef.current?.click()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Upload your own artwork"}
              </button>
              <input
                ref={artworkInputRef}
                type="file"
                accept={ARTWORK_ACCEPT}
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadArtwork(file);
                  e.target.value = "";
                }}
              />
            </>
          ) : (
            <Link
              href="/billing"
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/15"
            >
              <span aria-hidden>🔒</span>
              Upgrade to upload your own artwork →
            </Link>
          )}
        </div>

        {savedDesigns.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 p-8 text-center text-sm text-muted">
            <p>No saved designs yet.</p>
            <p>
              {customArtworkEnabled
                ? "Upload your own artwork above, or start from a template below."
                : "Start from a template below to make your first design."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {savedDesigns.map((design) => (
              <div key={design.id} className="card flex flex-col gap-2 p-3">
                <a
                  href={`/designs/${design.id}/edit`}
                  aria-label={`Edit ${design.name}`}
                  className="group relative block aspect-[105/148] w-full overflow-hidden rounded-md bg-foreground/5"
                >
                  <SavedDesignThumb document={design.document} />
                  {/* Keep the "Edit" affordance the tile always had — now as a
                      hover overlay over the visible artwork. */}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-xs font-medium text-white opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
                    Edit
                  </span>
                </a>
                <span className="truncate text-sm font-medium" title={design.name}>
                  {design.name}
                </span>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
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

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Templates</h2>
          <p className="text-sm text-muted">
            Pick a design to personalise — it&apos;s saved to My designs.
          </p>
        </div>

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
                <div className="relative aspect-[105/148] w-full overflow-hidden rounded-md bg-foreground/5">
                  <Image
                    src={template.thumbnailUrl}
                    alt={template.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    placeholder="blur"
                    blurDataURL={CARD_BLUR_DATA_URL}
                    unoptimized={!isOptimizableThumbnail(template.thumbnailUrl)}
                    className="object-cover"
                  />
                </div>
                <span className="truncate text-sm font-medium" title={template.name}>
                  {template.name}
                </span>
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
    </div>
  );
}
