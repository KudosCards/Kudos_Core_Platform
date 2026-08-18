import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { JsonLd } from "@/components/json-ld";
import { MarketingFooter } from "@/components/marketing-footer";
import { FAQ_SECTIONS } from "@/lib/faq";
import { openGraphFor } from "@/lib/site";
import { breadcrumbSchema, faqPageSchema } from "@/lib/structured-data";

const DESCRIPTION =
  "What a card costs, how quickly we post, what's on each plan, and what happens if a card comes back — the questions people actually ask before their first send.";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: DESCRIPTION,
  alternates: { canonical: "/faq" },
  openGraph: openGraphFor({
    url: "/faq",
    title: "Kudos Cards FAQ",
    description: DESCRIPTION,
  }),
};

/** Anchor id for a section heading — "Getting started" → "getting-started". */
function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The public FAQ.
 *
 * Fully static: the answers come from `lib/faq.ts`, which resolves its numbers
 * from the pricing and plan constants, so this page needs no data fetching and
 * cannot quote a price the basket disagrees with. The content is plain prose in
 * the markup — no accordion, no client JavaScript — because a page of fourteen
 * short answers is faster to read open than to click through, and because what a
 * crawler sees is then exactly what a visitor sees.
 */
export default function FaqPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd data={faqPageSchema()} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ])}
      />
      <PublicHeader navLinks={[{ href: "/cards", label: "Card library" }]} />

      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Frequently asked questions
        </h1>
        <p className="mt-4 text-lg text-slate-600">{DESCRIPTION}</p>

        {/* Jump links: a table of contents a reader can scan in one glance, and
            a set of internal links to the page's own headings for a crawler. */}
        <nav aria-label="Sections" className="mt-8 border-y border-slate-100 py-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {FAQ_SECTIONS.map((section) => (
              <li key={section.heading}>
                <a
                  href={`#${sectionId(section.heading)}`}
                  className="font-medium text-rose-600 hover:underline"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-12 flex flex-col gap-14">
          {FAQ_SECTIONS.map((section) => (
            <section key={section.heading} id={sectionId(section.heading)}>
              <h2 className="text-xs font-semibold tracking-widest text-slate-400 uppercase">
                {section.heading}
              </h2>
              <dl className="mt-5 flex flex-col gap-8">
                {section.entries.map((entry) => (
                  <div key={entry.question}>
                    <dt className="text-lg font-bold tracking-tight">{entry.question}</dt>
                    <dd className="mt-2 flex flex-col gap-3 text-slate-600">
                      {entry.answer.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                      {entry.link && (
                        <p>
                          <Link
                            href={entry.link.href}
                            className="font-medium text-rose-600 hover:underline"
                          >
                            {entry.link.label} →
                          </Link>
                        </p>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <section className="mt-16 rounded-2xl bg-slate-50 px-6 py-8 text-center">
          <h2 className="text-xl font-extrabold tracking-tight">Still not sure?</h2>
          <p className="mx-auto mt-2 max-w-lg text-slate-600">
            Have a look at the cards — you can send one without an account, and there&apos;s nothing
            to pay until you do.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              href="/cards"
              className="inline-flex min-h-11 items-center rounded-full bg-rose-600 px-5 text-sm font-semibold text-white hover:opacity-90"
            >
              Browse the card library
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:border-slate-300"
            >
              Create a free account
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
