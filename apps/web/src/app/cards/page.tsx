import type { Metadata } from "next";
import type { CardDesign } from "@kudos/shared-types";
import { CARD_SIZE_NOTICE } from "@kudos/shared-types";
import { publicApiFetch, CATALOG_REVALIDATE_SECONDS } from "@/lib/api.public";
import { breadcrumbSchema } from "@/lib/structured-data";
import { JsonLd } from "@/components/json-ld";
import { isPublishableCard } from "@/lib/card-urls";
import { CardsHeader } from "./cards-header";
import { CardsGalleryClient } from "./cards-gallery-client";

export const metadata: Metadata = {
  title: "Card library",
  description:
    "Browse our range of card designs. Pick one, personalise it, and we print and post it for you.",
  alternates: { canonical: "/cards" },
};

// ISR: the catalog is the same for everyone, so serve this from the CDN and
// regenerate hourly instead of hitting the DB per visit. Keep in sync with
// CATALOG_REVALIDATE_SECONDS. See docs/adr/0044-public-catalog-isr.md.
export const revalidate = 3600;

export default async function CardsPage() {
  // Cards the API hasn't given a slug yet can't be linked to — see
  // isPublishableCard(). Filtering keeps the library rendering during a deploy
  // where the web is ahead of the API, rather than linking to a broken URL.
  const templates = (
    (await publicApiFetch<CardDesign[]>("/card-designs", {
      revalidate: CATALOG_REVALIDATE_SECONDS,
    })) ?? []
  ).filter(isPublishableCard);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Card library", path: "/cards" },
        ])}
      />
      <CardsHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex max-w-2xl flex-col gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Our card library</h1>
          <p className="text-slate-600">
            Pick a design you love, personalise it with your centre&apos;s message, and we print and
            post a real card. No account needed to browse.
          </p>
          <p className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {CARD_SIZE_NOTICE}
          </p>
        </div>
        <div className="mt-8">
          <CardsGalleryClient templates={templates} />
        </div>
      </main>
    </div>
  );
}
