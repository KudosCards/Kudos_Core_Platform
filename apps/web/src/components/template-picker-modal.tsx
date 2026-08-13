"use client";

import type { CardDesign } from "@kudos/shared-types";
import Image from "next/image";
import { useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { CARD_BLUR_DATA_URL, isOptimizableThumbnail } from "@/lib/card-image";

const ALL = "all";

/** "birthday" -> "Birthday". */
function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Pick a catalog template to start a brand-new design from — the "＋ New design"
 * entry point on the bulk-send composer, so a buyer can create a card without
 * leaving the payment page and losing their contact selection. Purely a chooser:
 * it renders the catalog with a category filter and hands the picked template
 * back via `onPick`; the caller creates the saved design and routes into the
 * editor (with a `returnTo` back here). Mirrors the /designs gallery's template
 * grid so the two stay visually consistent.
 */
export function TemplatePickerModal({
  templates,
  open,
  onClose,
  onPick,
  busyTemplateId,
}: {
  templates: CardDesign[];
  open: boolean;
  onClose: () => void;
  onPick: (template: CardDesign) => void;
  busyTemplateId?: string | null;
}) {
  const [category, setCategory] = useState<string>(ALL);
  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [templates],
  );
  const visible = useMemo(
    () => (category === ALL ? templates : templates.filter((t) => t.category === category)),
    [templates, category],
  );

  return (
    <Modal open={open} onClose={onClose} title="Start a new design">
      {templates.length === 0 ? (
        <p className="text-sm text-muted">No templates are available yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Pick a template to open in the editor — we&apos;ll bring you back here with it ready to
            send.
          </p>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {[ALL, ...categories].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    category === c
                      ? "bg-accent text-white"
                      : "border border-border text-muted hover:bg-foreground/[0.03]"
                  }`}
                >
                  {c === ALL ? "All" : formatCategory(c)}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {visible.map((template) => {
              const busy = busyTemplateId === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  disabled={busy || busyTemplateId != null}
                  onClick={() => onPick(template)}
                  className="group flex flex-col gap-1.5 rounded-lg border border-border p-2 text-left transition-colors hover:border-accent hover:bg-foreground/[0.03] disabled:opacity-60"
                >
                  <span className="relative block aspect-[105/148] w-full overflow-hidden rounded-md bg-foreground/5">
                    <Image
                      src={template.thumbnailUrl}
                      alt={template.name}
                      fill
                      sizes="150px"
                      placeholder="blur"
                      blurDataURL={CARD_BLUR_DATA_URL}
                      unoptimized={!isOptimizableThumbnail(template.thumbnailUrl)}
                      className="object-cover"
                    />
                  </span>
                  <span className="truncate text-xs font-medium" title={template.name}>
                    {busy ? "Opening…" : template.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
