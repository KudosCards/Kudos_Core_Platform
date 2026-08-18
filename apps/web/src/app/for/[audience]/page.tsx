import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { JsonLd } from "@/components/json-ld";
import { MarketingFooter } from "@/components/marketing-footer";
import { AUDIENCES, audiencePlan, getAudience } from "@/lib/audiences";
import { openGraphFor } from "@/lib/site";
import { breadcrumbSchema } from "@/lib/structured-data";

/** Seven pages from one module — all known at build time, none dynamic. */
export function generateStaticParams(): { audience: string }[] {
  return AUDIENCES.map((audience) => ({ audience: audience.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ audience: string }>;
}): Promise<Metadata> {
  const { audience: slug } = await params;
  const audience = getAudience(slug);
  if (!audience) {
    return { title: "Who Kudos Cards is for" };
  }
  return {
    title: audience.title,
    description: audience.description,
    alternates: { canonical: `/for/${audience.slug}` },
    openGraph: openGraphFor({
      url: `/for/${audience.slug}`,
      title: audience.title,
      description: audience.description,
    }),
  };
}

/**
 * One audience — `/for/schools`.
 *
 * The template is shared; the content is not. Each page names different dates,
 * different features and a different plan, because a page that's the homepage
 * with one noun swapped is a doorway page, and that's the failure mode this
 * whole section is one step away from. See ADR 0164 and lib/audiences.ts.
 */
export default async function AudiencePage({ params }: { params: Promise<{ audience: string }> }) {
  const { audience: slug } = await params;
  const audience = getAudience(slug);
  if (!audience) {
    notFound();
  }

  const plan = audiencePlan(audience);
  const others = AUDIENCES.filter((other) => other.slug !== audience.slug);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Who it's for", path: "/for" },
          { name: audience.name, path: `/for/${audience.slug}` },
        ])}
      />
      <PublicHeader
        navLinks={[
          { href: "/cards", label: "Card library" },
          { href: "/faq", label: "FAQ" },
        ]}
      />

      <main>
        <section className="bg-gradient-to-b from-sky-50 to-white">
          <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
            <nav className="text-sm text-slate-500">
              <Link href="/for" className="hover:text-slate-900">
                ← Who it&apos;s for
              </Link>
            </nav>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              {audience.heading}
            </h1>
            <div className="mt-5 flex flex-col gap-4 text-lg text-slate-600">
              {audience.intro.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex min-h-11 items-center rounded-full bg-rose-600 px-5 text-sm font-semibold text-white hover:opacity-90"
              >
                Start free
              </Link>
              <Link
                href="/cards"
                className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:border-slate-300"
              >
                See the cards
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-14">
          <h2 className="text-2xl font-extrabold tracking-tight">The dates that matter</h2>
          <dl className="mt-6 flex flex-col gap-6">
            {audience.moments.map((moment) => (
              <div key={moment.name} className="border-l-2 border-rose-200 pl-5">
                <dt className="font-bold tracking-tight">{moment.name}</dt>
                <dd className="mt-1 text-slate-600">{moment.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-y border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-3xl px-6 py-14">
            <h2 className="text-2xl font-extrabold tracking-tight">How it works for you</h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {audience.fit.map((item) => (
                <div key={item.heading} className="flex flex-col gap-2">
                  <h3 className="font-bold tracking-tight">{item.heading}</h3>
                  <p className="text-sm text-slate-600">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-14">
          <h2 className="text-2xl font-extrabold tracking-tight">
            The plan that usually fits: {plan.name}
          </h2>
          <p className="mt-3 text-slate-600">{audience.planReason}</p>
          <ul className="mt-5 flex flex-col gap-2 text-slate-600">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-0.5 text-emerald-500">✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-slate-500">
            Nothing here is locked in — plans change from the billing page, and every plan pays for
            cards the same way, per card plus a stamp.{" "}
            <Link href="/#plans" className="font-medium text-rose-600 hover:underline">
              Compare all plans
            </Link>
          </p>
        </section>

        {/* Sideways links: every audience page is one click from the others, so
            the section is crawlable from any entry point, not just the hub. */}
        <section className="border-t border-slate-100">
          <div className="mx-auto max-w-3xl px-6 py-12">
            <h2 className="text-sm font-semibold text-slate-900">Also used by</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {others.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/for/${other.slug}`}
                    className="inline-block rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  >
                    {other.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-slate-500">
              Questions about price, postage or what happens if a card comes back?{" "}
              <Link href="/faq" className="font-medium text-rose-600 hover:underline">
                Read the FAQ
              </Link>
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
