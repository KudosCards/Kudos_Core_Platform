import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { JsonLd } from "@/components/json-ld";
import { AUDIENCES } from "@/lib/audiences";
import { openGraphFor } from "@/lib/site";
import { breadcrumbSchema } from "@/lib/structured-data";
import { MarketingFooter } from "@/components/marketing-footer";

/** "Businesses, tuition centres, … and individuals" — built from AUDIENCES so
 *  the sentence can't list an audience that no longer has a page, or miss one
 *  that does. */
const AUDIENCE_LIST = AUDIENCES.map((audience, index) =>
  index === 0 ? audience.name : audience.name.toLowerCase(),
);
const DESCRIPTION = `${AUDIENCE_LIST.slice(0, -1).join(", ")} and ${AUDIENCE_LIST.at(-1)} — what Kudos Cards does for each, and which plan usually fits.`;

export const metadata: Metadata = {
  title: "Who Kudos Cards is for",
  description: DESCRIPTION,
  alternates: { canonical: "/for" },
  openGraph: openGraphFor({
    url: "/for",
    title: "Who Kudos Cards is for",
    description: DESCRIPTION,
  }),
};

/**
 * The hub above the audience pages.
 *
 * It exists so the seven pages are one click from each other and from the
 * homepage, rather than reachable only via the "Used by" pills — a set of leaf
 * pages with a single entry point each is how internal links go thin.
 */
export default function AudiencesPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Who it's for", path: "/for" },
        ])}
      />
      <PublicHeader
        navLinks={[
          { href: "/cards", label: "Card library" },
          { href: "/faq", label: "FAQ" },
        ]}
      />

      <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Who Kudos Cards is for
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-600">{DESCRIPTION}</p>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2">
          {AUDIENCES.map((audience) => (
            <li key={audience.slug}>
              <Link
                href={`/for/${audience.slug}`}
                className="flex h-full flex-col gap-2 rounded-2xl border border-slate-200 p-6 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <h2 className="text-lg font-bold tracking-tight">{audience.name}</h2>
                <p className="text-sm text-slate-600">{audience.description}</p>
                <span className="mt-auto pt-2 text-sm font-medium text-rose-600">
                  What it looks like →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <MarketingFooter />
    </div>
  );
}
