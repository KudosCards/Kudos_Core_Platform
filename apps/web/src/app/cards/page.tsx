import type { Metadata } from "next";
import type { CardDesign } from "@kudos/shared-types";
import { publicApiFetch } from "@/lib/api.public";
import { CardsHeader } from "./cards-header";
import { CardsGalleryClient } from "./cards-gallery-client";

export const metadata: Metadata = {
  title: "Card library — Kudos Cards",
  description: "Browse our range of card designs. Pick one, personalise it, and we print and post it for you.",
};

export default async function CardsPage() {
  const templates = (await publicApiFetch<CardDesign[]>("/card-designs")) ?? [];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <CardsHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex max-w-2xl flex-col gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Our card library</h1>
          <p className="text-slate-600">
            Pick a design you love, personalise it with your centre&apos;s message, and we print and
            post a real card. No account needed to browse.
          </p>
        </div>
        <div className="mt-8">
          <CardsGalleryClient templates={templates} />
        </div>
      </main>
    </div>
  );
}
