"use client";

import type { CardDesign } from "@kudos/shared-types";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

const ALL = "all";

/** "well done" -> "Well done". */
function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function CardsGalleryClient({ templates }: { templates: CardDesign[] }) {
  const [category, setCategory] = useState<string>(ALL);

  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [templates],
  );
  const visible = useMemo(
    () => (category === ALL ? templates : templates.filter((t) => t.category === category)),
    [templates, category],
  );

  if (templates.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
        Our card library is on its way — check back shortly.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {[ALL, ...categories].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
                option === category
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {option === ALL ? "All cards" : formatCategory(option)}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((template) => (
          <Link
            key={template.id}
            href={`/cards/${template.id}`}
            className="group flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100 transition-shadow hover:shadow-lg"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-slate-50">
              <Image
                src={template.thumbnailUrl}
                alt={template.name}
                fill
                unoptimized
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <div className="flex flex-col gap-0.5 px-1 pb-1">
              <span className="text-sm font-semibold text-slate-900">{template.name}</span>
              <span className="text-xs text-slate-500">{formatCategory(template.category)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
