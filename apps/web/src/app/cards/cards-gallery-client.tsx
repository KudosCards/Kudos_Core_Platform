"use client";

import type { CardDesign } from "@kudos/shared-types";
import Image from "next/image";
import { CARD_BLUR_DATA_URL, isOptimizableThumbnail } from "@/lib/card-image";
import Link from "next/link";
import { useMemo, useState } from "react";

const ALL = "all";

/** "well done" -> "Well done". */
function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** A single catalog card with a clear "Personalise" call to action. `width`
 * lets the carousel give tiles a fixed size while the grid lets them flex. */
function CardTile({ template, className = "" }: { template: CardDesign; className?: string }) {
  return (
    <Link
      href={`/cards/${template.id}`}
      className={`group flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100 transition-shadow hover:shadow-lg ${className}`}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-slate-50">
        <Image
          src={template.thumbnailUrl}
          alt={template.name}
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          placeholder="blur"
          blurDataURL={CARD_BLUR_DATA_URL}
          unoptimized={!isOptimizableThumbnail(template.thumbnailUrl)}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {/* Make the action unmistakable — a personalise pill that lifts in on hover. */}
        <span className="pointer-events-none absolute inset-x-2 bottom-2 translate-y-2 rounded-full bg-slate-900/90 px-3 py-1.5 text-center text-xs font-semibold text-white opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          Personalise this card →
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <span className="text-sm font-semibold text-slate-900">{template.name}</span>
        <span className="text-xs text-slate-500">{formatCategory(template.category)}</span>
      </div>
    </Link>
  );
}

export function CardsGalleryClient({ templates }: { templates: CardDesign[] }) {
  const [category, setCategory] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [templates],
  );

  // Search matches the card name or its category, case-insensitive.
  const matchesSearch = (t: CardDesign) =>
    query === "" ||
    t.name.toLowerCase().includes(query) ||
    t.category.toLowerCase().includes(query);

  const visible = useMemo(
    () =>
      templates.filter((t) => (category === ALL || t.category === category) && matchesSearch(t)),
    // matchesSearch closes over `query`; templates/category/query are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, category, query],
  );

  // Carousel mode: only when browsing everything with no active search — group
  // the catalog into a horizontal row per category so it reads like a shop.
  // Any filter/search collapses to a single flat, scannable grid.
  const carouselMode = category === ALL && query === "";
  const grouped = useMemo(() => {
    if (!carouselMode) return [];
    return categories
      .map((cat) => ({ category: cat, cards: templates.filter((t) => t.category === cat) }))
      .filter((g) => g.cards.length > 0);
  }, [carouselMode, categories, templates]);

  if (templates.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
        Our card library is on its way — check back shortly.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="relative max-w-md">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards — e.g. birthday, thank you…"
            aria-label="Search the card library"
            className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          )}
        </div>

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
      </div>

      {carouselMode ? (
        <div className="flex flex-col gap-10">
          {grouped.map((group) => (
            <section key={group.category} className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">
                  {formatCategory(group.category)}
                </h2>
                <button
                  type="button"
                  onClick={() => setCategory(group.category)}
                  className="text-sm font-medium text-slate-500 hover:text-slate-900"
                >
                  See all {group.cards.length} →
                </button>
              </div>
              {/* Horizontal, snap-scrolling row — the "shop shelf" feel. */}
              <div className="-mx-1 flex snap-x gap-5 overflow-x-auto px-1 pb-2">
                {group.cards.map((template) => (
                  <CardTile
                    key={template.id}
                    template={template}
                    className="w-40 shrink-0 snap-start sm:w-44"
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-500">
            {visible.length} card{visible.length === 1 ? "" : "s"}
            {query && (
              <>
                {" "}
                for “{search.trim()}”
              </>
            )}
          </p>
          {visible.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
              No cards match — try a different search or category.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((template) => (
                <CardTile key={template.id} template={template} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
