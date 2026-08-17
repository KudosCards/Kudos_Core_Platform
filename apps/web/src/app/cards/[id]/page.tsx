import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { CardDesign } from "@kudos/shared-types";
import { CARD_PRICE_MINOR, CARD_SIZE_LABEL } from "@kudos/shared-types";
import { publicApiFetch, CATALOG_REVALIDATE_SECONDS } from "@/lib/api.public";
import { CARD_BLUR_DATA_URL, isOptimizableThumbnail } from "@/lib/card-image";
import { openGraphFor } from "@/lib/site";
import { CardsHeader } from "../cards-header";
import { PersonaliseButton } from "./personalise-button";

// ISR: catalog data is the same for every visitor; unknown ids render on-demand
// then cache, and each is regenerated hourly. Keep in sync with
// CATALOG_REVALIDATE_SECONDS. See docs/adr/0044-public-catalog-isr.md.
export const revalidate = 3600;

// Prerender every catalog card at build so the previews serve fully static from
// the CDN. Build-safe: publicApiFetch returns null (→ no params) if the API is
// unreachable at build time, and dynamicParams (default) still renders any
// not-yet-prerendered id on demand.
export async function generateStaticParams(): Promise<{ id: string }[]> {
  const templates = await publicApiFetch<CardDesign[]>("/card-designs", {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  return (templates ?? []).map((card) => ({ id: card.id }));
}

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const card = await publicApiFetch<CardDesign>(`/card-designs/${id}`, {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  if (!card) {
    return { title: "Card", alternates: { canonical: `/cards/${id}` } };
  }

  const description = `${card.name} — personalised with every recipient's name, then printed and posted for you from £${(CARD_PRICE_MINOR / 100).toFixed(2)} a card.`;

  return {
    title: card.name,
    description,
    alternates: { canonical: `/cards/${id}` },
    // The card's own artwork is the share image — a real card front sells the
    // link better than the site-wide OG image this overrides.
    openGraph: openGraphFor({
      type: "article",
      url: `/cards/${id}`,
      title: card.name,
      description,
      images: [{ url: card.thumbnailUrl, alt: card.name }],
    }),
  };
}

export default async function CardPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await publicApiFetch<CardDesign>(`/card-designs/${id}`, {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  if (!card) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <CardsHeader />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Link href="/cards" className="text-sm text-slate-500 hover:text-slate-900">
          ← Back to the card library
        </Link>
        <div className="mt-6 grid items-start gap-10 md:grid-cols-2">
          <div className="relative mx-auto aspect-[105/148] w-full max-w-sm overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-slate-100">
            <Image
              src={card.thumbnailUrl}
              alt={card.name}
              fill
              // The product-page hero is this route's LCP — load it eagerly
              // instead of lazily so it paints as fast as possible.
              priority
              sizes="(min-width: 768px) 384px, 100vw"
              placeholder="blur"
              blurDataURL={CARD_BLUR_DATA_URL}
              unoptimized={!isOptimizableThumbnail(card.thumbnailUrl)}
              className="object-cover"
            />
          </div>
          <div className="flex flex-col gap-5">
            <span className="w-fit rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
              {formatCategory(card.category)}
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{card.name}</h1>
            <p className="text-slate-600">
              Make it yours — add your centre&apos;s message and every student&apos;s name is merged
              in automatically. We print it and post a real card to their home.
            </p>
            <ul className="flex flex-col gap-2 text-sm text-slate-600">
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Personalised with each recipient&apos;s
                name
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Printed &amp; posted for you — from
                £2.50 a card
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Add a scan-to-watch message page —
                video, note &amp; link
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Printed {CARD_SIZE_LABEL} — more sizes
                coming soon
              </li>
            </ul>
            <div className="pt-2">
              <PersonaliseButton cardId={card.id} cardName={card.name} />
              <p className="mt-2 text-xs text-slate-500">
                Free to start — you only pay when you send a card.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
