import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { JsonLd } from "@/components/json-ld";
import { MarketingFooter } from "@/components/marketing-footer";
import { GUIDES, getGuide, guideCategory } from "@/lib/guides";
import { openGraphFor } from "@/lib/site";
import { breadcrumbSchema, guideArticleSchema } from "@/lib/structured-data";

export function generateStaticParams(): { guide: string }[] {
  return GUIDES.map((guide) => ({ guide: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guide: string }>;
}): Promise<Metadata> {
  const { guide: slug } = await params;
  const guide = getGuide(slug);
  if (!guide) {
    return { title: "Card writing guides" };
  }
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: openGraphFor({
      type: "article",
      url: `/guides/${guide.slug}`,
      title: guide.title,
      description: guide.description,
    }),
  };
}

/**
 * One guide — `/guides/what-to-write-in-a-birthday-card`.
 *
 * The point of the page, commercially, is the link out to the matching card
 * category: someone searching for wording is one step from needing a card. That
 * link is resolved from CARD_CATEGORIES rather than typed, so a renamed category
 * can't leave a guide pointing at a 404.
 */
export default async function GuidePage({ params }: { params: Promise<{ guide: string }> }) {
  const { guide: slug } = await params;
  const guide = getGuide(slug);
  if (!guide) {
    notFound();
  }

  const category = guideCategory(guide);
  const others = GUIDES.filter((other) => other.slug !== guide.slug);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd data={guideArticleSchema(guide)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Guides", path: "/guides" },
          { name: guide.heading, path: `/guides/${guide.slug}` },
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
        <nav className="text-sm text-slate-500">
          <Link href="/guides" className="hover:text-slate-900">
            ← All guides
          </Link>
        </nav>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{guide.heading}</h1>
        <div className="mt-5 flex flex-col gap-4 text-lg text-slate-600">
          {guide.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-12">
          {guide.groups.map((group) => (
            <section key={group.audience}>
              <h2 className="text-2xl font-extrabold tracking-tight">{group.audience}</h2>
              <p className="mt-2 text-slate-600">{group.note}</p>
              <ul className="mt-5 flex flex-col gap-3">
                {group.examples.map((example) => (
                  <li
                    key={example}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-700"
                  >
                    {example}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* The merge-token note, once, where the examples have just used them —
            rather than a footnote under every single line. */}
        <p className="mt-8 rounded-xl border border-slate-200 px-5 py-4 text-sm text-slate-500">
          {/* One expression, not `{"{firstName}"} isn't ...` — JSX drops the
              space between an expression and the text that follows it. */}
          <span className="font-medium text-slate-700">
            {"{firstName} isn't something you type out."}
          </span>{" "}
          Write the message once with it in, and every card in the send is printed with that
          person’s own name.
        </p>

        <section className="mt-14">
          <h2 className="text-2xl font-extrabold tracking-tight">Getting it right</h2>
          <dl className="mt-6 flex flex-col gap-6">
            {guide.tips.map((tip) => (
              <div key={tip.heading} className="border-l-2 border-rose-200 pl-5">
                <dt className="font-bold tracking-tight">{tip.heading}</dt>
                <dd className="mt-1 text-slate-600">{tip.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-14 rounded-2xl bg-slate-50 px-6 py-8 text-center">
          <h2 className="text-xl font-extrabold tracking-tight">Now pick the card</h2>
          <p className="mx-auto mt-2 max-w-lg text-slate-600">{category.description}</p>
          <div className="mt-5">
            <Link
              href={`/cards/${category.slug}`}
              className="inline-flex min-h-11 items-center rounded-full bg-rose-600 px-5 text-sm font-semibold text-white hover:opacity-90"
            >
              Browse {category.name.toLowerCase()} cards
            </Link>
          </div>
        </section>

        <nav className="mt-14 border-t border-slate-100 pt-8">
          <h2 className="text-sm font-semibold text-slate-900">More guides</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/guides/${other.slug}`}
                  className="text-slate-600 hover:text-slate-900 hover:underline"
                >
                  {other.heading}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <MarketingFooter />
    </div>
  );
}
