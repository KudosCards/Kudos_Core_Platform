import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { JsonLd } from "@/components/json-ld";
import { MarketingFooter } from "@/components/marketing-footer";
import { GUIDES } from "@/lib/guides";
import { openGraphFor } from "@/lib/site";
import { breadcrumbSchema } from "@/lib/structured-data";

const DESCRIPTION =
  "What to write in a card when it's going to a customer, a student, a donor or a club member — worked examples, grouped by who's receiving it.";

export const metadata: Metadata = {
  title: "Card writing guides",
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: openGraphFor({
    url: "/guides",
    title: "Card writing guides",
    description: DESCRIPTION,
  }),
};

export default function GuidesPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Guides", path: "/guides" },
        ])}
      />
      <PublicHeader
        navLinks={[
          { href: "/cards", label: "Card library" },
          { href: "/guides", label: "Guides" },
          { href: "/faq", label: "FAQ" },
        ]}
      />

      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Card writing guides</h1>
        <p className="mt-4 text-lg text-slate-600">{DESCRIPTION}</p>

        <ul className="mt-10 flex flex-col gap-4">
          {GUIDES.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/guides/${guide.slug}`}
                className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-6 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <h2 className="text-lg font-bold tracking-tight">{guide.heading}</h2>
                <p className="text-sm text-slate-600">{guide.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <MarketingFooter />
    </div>
  );
}
