import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { CardDesign } from "@kudos/shared-types";
import { publicApiFetch } from "@/lib/api.public";
import { CardsHeader } from "../cards-header";
import { PersonaliseButton } from "./personalise-button";

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const card = await publicApiFetch<CardDesign>(`/card-designs/${id}`);
  return {
    title: card ? `${card.name} — Kudos Cards` : "Card — Kudos Cards",
  };
}

export default async function CardPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await publicApiFetch<CardDesign>(`/card-designs/${id}`);
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
          <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-slate-100">
            <Image src={card.thumbnailUrl} alt={card.name} fill unoptimized className="object-cover" />
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
                <span className="text-emerald-500">✓</span> Personalised with each recipient&apos;s name
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Printed &amp; posted for you — from £2.50 a card
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Add a QR video message inside
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
