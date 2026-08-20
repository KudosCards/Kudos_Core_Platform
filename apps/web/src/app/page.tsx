import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ENTERPRISE_PLAN,
  PLAN_CATALOG,
  formatPlanPrice,
  planCardPriceLabel,
} from "@kudos/shared-types";
import { openGraphFor } from "@/lib/site";
import { organisationSchema, webSiteSchema } from "@/lib/structured-data";
import { JsonLd } from "@/components/json-ld";
import { PublicHeader } from "@/components/public-header";
import { AUDIENCES } from "@/lib/audiences";
import { SocialLinks } from "@/components/social-links";

/**
 * Public marketing landing — the page web traffic lands on. Sells the
 * membership and funnels visitors into sign up / log in → the customer app.
 * Deliberately light-committed (its own brand look), independent of the app's
 * light/dark theme. Assets live in /public/marketing (from the repo /images).
 */

/**
 * `title.absolute` so the root template doesn't append the brand twice — the
 * homepage title already ends in it. Written to be read in a search result:
 * what we sell first, who it's for second. See docs/seo-plan.md (Phase 2).
 */
export const metadata: Metadata = {
  title: { absolute: "Personalised cards, printed and posted — Kudos Cards" },
  description:
    "Send one card or automate thousands. We print and post real, personalised cards for birthdays, thank-yous and milestones — so you never miss another date.",
  alternates: { canonical: "/" },
  openGraph: openGraphFor({
    url: "/",
    title: "Personalised cards, printed and posted — Kudos Cards",
    description:
      "Send one card or automate thousands. We print and post real, personalised cards for birthdays, thank-yous and milestones.",
  }),
};

const CORAL = "#ef5b52";

const pains = [
  "Birthdays and milestones that quietly slip past",
  "Customers, members and students who start to feel forgotten",
  "Hours lost buying cards, writing them, stamping and posting",
  "Meaning to send something thoughtful, then never finding the time",
];

const steps = [
  {
    step: "1",
    title: "Add the people you care about",
    body: "Send a single card to one person, or upload your whole list from a spreadsheet. Customers, members, students, staff, family, whoever matters to you.",
  },
  {
    step: "2",
    title: "Choose when it goes",
    body: "Send it now for a one-off, or tell us the birthdays and key dates and we'll post a card every year. We can remind you first, or just get on with it for you.",
  },
  {
    step: "3",
    title: "We print it and post it",
    body: "Pick a design and add your message. We print the card, pop it in an envelope and post it, so a real card lands on their doormat.",
  },
];

const categories = [
  { src: "/marketing/cat-birthday.png", label: "Birthday" },
  { src: "/marketing/cat-achievement.png", label: "Achievement" },
  { src: "/marketing/cat-academic.png", label: "Academic" },
  { src: "/marketing/cat-thankyou.png", label: "Thank You" },
  { src: "/marketing/cat-funny.png", label: "Funny" },
];

const benefits = [
  {
    title: "Stronger loyalty",
    body: "Customers, members and students who feel valued don't look elsewhere.",
  },
  {
    title: "Word-of-mouth and referrals",
    body: "A real card through the door becomes a talking point people share.",
  },
  {
    title: "Hours saved every month",
    body: "Zero admin, zero trips to the card shop.",
  },
  {
    title: "Win back the ones who drifted",
    body: "A simple, thoughtful card can be the reason someone comes back.",
  },
];

/**
 * Hero card cluster — a 2×2 stack of real card fronts. The two columns are
 * offset vertically on desktop so the cluster reads as a pile of cards rather
 * than a grid.
 */
const heroCards = {
  birthday: {
    src: "/marketing/card-birthday.png",
    alt: "A personalised Happy Birthday card",
  },
  thankYou: {
    src: "/marketing/card-thankyou.png",
    alt: "A personalised Thank You card",
  },
  wellDone: {
    src: "/marketing/card-welldone.png",
    alt: "A personalised Congratulations card",
  },
  achievement: {
    src: "/marketing/card-achievement.png",
    alt: "A personalised Achievement card",
  },
};

/**
 * The benefits section's visual: one customer's year, so "people who feel
 * remembered stick around" is shown rather than asserted. Illustrative — a
 * typical year for a tuition centre, not a real account — and deliberately
 * free of numbers so there's no stat here to fall out of date.
 */
const customerYear = [
  {
    month: "Jan",
    title: "Joins your centre",
    body: "You add them once, with their birthday.",
  },
  {
    month: "Mar",
    title: "Birthday card lands",
    body: "Posted for you, no reminder needed.",
    card: { src: "/marketing/card-birthday.png", alt: "A Happy Birthday card", tilt: "rotate-3" },
  },
  {
    month: "Jul",
    title: "Exam results are in",
    body: "A well done card goes out the same week.",
    card: { src: "/marketing/card-welldone.png", alt: "A Congratulations card", tilt: "-rotate-2" },
  },
  {
    month: "Nov",
    title: "End of a good year",
    body: "A thank-you card, from you to them.",
    card: { src: "/marketing/card-thankyou.png", alt: "A Thank You card", tilt: "rotate-2" },
  },
];

const reviews = [
  {
    name: "Ann Bennett",
    body: "We have been absolutely delighted with Kudos Cards! Such a wonderful way to celebrate and recognise students' achievements. The feedback from parents and students has been fantastic — a simple but powerful way to build motivation and strengthen the connection between school, students and families.",
  },
  {
    name: "Liz Martin",
    body: "Adding a personal touch to my service is important to me, but with so many demands on my time it can be hard to stay consistent. This system makes it easy to send thoughtful, high-quality cards for birthdays, achievements and milestones. It helps me ensure no special occasion is overlooked.",
  },
  {
    name: "Sarah T. — Tuition Centre Owner, Manchester",
    body: "Set it up in 10 minutes. Cards just go out. Parents message us to say thank you — that never happened before.",
  },
];

function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/marketing/logo.png"
      alt="Kudos Cards — Because you Care"
      width={410}
      height={475}
      className={className}
      sizes="80px"
    />
  );
}

function Stars() {
  return <span className="text-amber-400">★★★★★</span>;
}

function HeroCard({ src, alt, priority }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl shadow-lg ring-1 ring-slate-900/10">
      <Image
        src={src}
        alt={alt}
        width={300}
        height={450}
        className="aspect-[2/3] w-full object-cover"
        sizes="(max-width: 768px) 45vw, 220px"
        priority={priority}
      />
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Who we are, for search engines: the registered company behind the site. */}
      <JsonLd data={organisationSchema()} />
      <JsonLd data={webSiteSchema()} />
      {/* Header — Moonpig-style: browse nav + Reminders prompt + Basket + Sign in */}
      <PublicHeader
        navLinks={[
          { href: "/#how", label: "How it works" },
          { href: "/cards", label: "Card library" },
          { href: "/#plans", label: "Plans" },
        ]}
      />

      {/* Hero */}
      <section className="bg-gradient-to-b from-sky-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:grid-cols-2 md:py-24">
          <div className="flex flex-col gap-6">
            <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-100">
              🟢 Trusted by businesses, tuition centres, schools &amp; clubs across the UK
            </span>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Send one card, or automate thousands
            </h1>
            <p className="text-xl font-semibold text-slate-700">
              Real, personalised cards, printed and posted for you. So you never miss another
              birthday, thank-you or big moment.
            </p>
            <p className="max-w-lg text-slate-600">
              Whether it&apos;s a single birthday card or a thank-you to your whole customer list,
              we print and post real cards for you. The people who matter feel remembered, and you
              never have to remember a date again. No admin, no forgotten birthdays.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/register"
                className="rounded-full px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: CORAL }}
              >
                Start for free, no card needed
              </Link>
              <a
                href="#how"
                className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
              >
                See how it works ↓
              </a>
            </div>
            <div className="mt-2 w-fit rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <Stars />
              <p className="mt-1 max-w-sm text-sm text-slate-600 italic">
                &quot;Set it up in 10 minutes. Cards just go out. Parents message us to say thank
                you — that never happened before.&quot;
              </p>
              <p className="mt-1 text-sm font-semibold">
                Sarah T. — Tuition Centre Owner, Manchester
              </p>
            </div>
          </div>
          <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-4 sm:gap-5">
            {/* Left column sits lower than the right so the four tiles stagger. */}
            <div className="flex flex-col gap-4 sm:gap-5 md:mt-10">
              <HeroCard {...heroCards.birthday} priority />
              <HeroCard {...heroCards.wellDone} />
            </div>
            <div className="flex flex-col gap-4 sm:gap-5">
              <HeroCard {...heroCards.thankYou} />
              <HeroCard {...heroCards.achievement} />
            </div>
          </div>
        </div>
        {/* Used by */}
        <div className="mx-auto max-w-6xl px-6 pb-10">
          <p className="text-center text-xs font-semibold tracking-widest text-slate-400 uppercase">
            Used by
          </p>
          {/* Each pill is now the entry point to that audience's page — the
              list itself comes from AUDIENCES, so the pills and the pages can't
              drift apart. See ADR 0164. */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {AUDIENCES.map((audience) => (
              <Link
                key={audience.slug}
                href={`/for/${audience.slug}`}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
              >
                {audience.pill}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:grid-cols-2">
        <Image
          src="/marketing/dashboard-calendar.png"
          alt="The Kudos Cards birthday calendar"
          width={1013}
          height={584}
          className="w-full rounded-xl shadow-xl ring-1 ring-slate-100"
          sizes="(max-width: 768px) 100vw, 550px"
        />
        <div className="flex flex-col gap-5">
          <span className="w-fit rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
            SOUND FAMILIAR?
          </span>
          <h2 className="text-3xl font-bold tracking-tight">
            Remembering everyone is the hard part
          </h2>
          <p className="text-slate-600">
            Most of us mean well. But without a system, the birthdays, thank-yous and milestones
            that matter quietly slip past.
          </p>
          <ul className="flex flex-col gap-3">
            {pains.map((pain) => (
              <li key={pain} className="flex items-start gap-3 text-slate-700">
                <span className="text-rose-500">✕</span>
                {pain}
              </li>
            ))}
          </ul>
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            ✓ Kudos Cards takes care of all of it, and takes about 10 minutes to set up.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-24 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
              SIMPLE BY DESIGN
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight">
              Up and running in three steps
            </h2>
            <p className="mt-3 text-slate-600">
              No technical knowledge needed. If you can upload a spreadsheet, you can use Kudos
              Cards.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div
                key={s.step}
                className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100"
              >
                <p className="text-xs font-bold tracking-widest" style={{ color: CORAL }}>
                  STEP {s.step}
                </p>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Card showcase */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <h2 className="text-3xl font-bold tracking-tight">
            Personalised with every recipient&apos;s name
          </h2>
          <p className="text-slate-600">
            Your own message, printed inside every card. Pick a design you like, add a QR code that
            links to a personal video or note if you want to, and we do the rest.
          </p>
          <div className="flex flex-wrap gap-3">
            {categories.map((cat) => (
              <div key={cat.label} className="flex flex-col items-center gap-1">
                <Image
                  src={cat.src}
                  alt={cat.label}
                  width={72}
                  height={72}
                  className="h-16 w-16 rounded-xl shadow-sm ring-1 ring-slate-100"
                  sizes="64px"
                />
                <span className="text-xs text-slate-500">{cat.label}</span>
              </div>
            ))}
          </div>
          <Link
            href="/cards"
            className="w-fit rounded-full px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: CORAL }}
          >
            Browse the card library →
          </Link>
        </div>
        <Image
          src="/marketing/card-welldone.png"
          alt="A personalised Well Done card"
          width={300}
          height={450}
          className="mx-auto w-full max-w-xs rounded-xl shadow-2xl ring-1 ring-slate-100"
          sizes="(max-width: 768px) 100vw, 320px"
        />
      </section>

      {/* Benefits */}
      <section className="bg-slate-50">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <span className="w-fit rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
              THE DIFFERENCE IT MAKES
            </span>
            <h2 className="text-3xl font-bold tracking-tight">
              People who feel remembered stick around
            </h2>
            <p className="text-slate-600">
              A real card on the doormat does something no text or email ever can. It shows you
              cared enough to send something real.
            </p>
            <ul className="flex flex-col gap-4">
              {benefits.map((b) => (
                <li key={b.title} className="flex items-start gap-3">
                  <span className="text-emerald-500">✓</span>
                  <span>
                    <span className="font-semibold">{b.title}.</span>{" "}
                    <span className="text-slate-600">{b.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/register"
              className="w-fit rounded-full px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: CORAL }}
            >
              Start for free, no card needed
            </Link>
          </div>
          {/* One customer's year — a timeline, not a product screenshot, so the
              section shows the pay-off rather than the tool. */}
          <div className="rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-100 sm:p-8">
            <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">
              A year with one customer
            </p>
            <ol className="mt-6">
              {customerYear.map((moment) => (
                <li
                  key={moment.month}
                  className="grid grid-cols-[2.25rem_0.75rem_1fr] gap-x-3 sm:grid-cols-[2.75rem_0.75rem_1fr] sm:gap-x-4"
                >
                  <span className="pt-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                    {moment.month}
                  </span>
                  <span className="relative flex justify-center">
                    <span
                      className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: CORAL }}
                    />
                    <span className="absolute top-5 bottom-0 left-1/2 w-px -translate-x-1/2 bg-slate-200" />
                  </span>
                  <div className="flex items-start justify-between gap-4 pb-8">
                    <div className="pt-0.5">
                      <p className="font-semibold">{moment.title}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{moment.body}</p>
                    </div>
                    {moment.card && (
                      <Image
                        src={moment.card.src}
                        alt={moment.card.alt}
                        width={300}
                        height={450}
                        className={`h-20 w-auto shrink-0 rounded-lg shadow-md ring-1 ring-slate-900/10 sm:h-24 ${moment.card.tilt}`}
                        sizes="64px"
                      />
                    )}
                  </div>
                </li>
              ))}
              {/* The pay-off, and the reason the timeline exists. */}
              <li className="grid grid-cols-[2.25rem_0.75rem_1fr] gap-x-3 sm:grid-cols-[2.75rem_0.75rem_1fr] sm:gap-x-4">
                <span className="pt-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  Jan
                </span>
                <span className="flex justify-center">
                  <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full bg-emerald-500" />
                </span>
                <div>
                  <p className="font-semibold text-emerald-700">Still with you ✓</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    And telling other parents where to find you.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* Reviews + stats (dark) */}
      <section className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="rounded-full bg-amber-400/20 px-3 py-1 text-xs font-semibold text-amber-300">
              VERIFIED REVIEWS
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight">
              Don&apos;t take our word for it
            </h2>
            <p className="mt-3 text-slate-300">
              Real feedback from the businesses, tutors and centres who use Kudos every day.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {reviews.map((r) => (
              <div
                key={r.name}
                className="flex flex-col gap-3 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10"
              >
                <Stars />
                <p className="text-sm text-slate-200">{r.body}</p>
                <p className="mt-auto text-sm font-semibold">{r.name}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 grid gap-6 border-t border-white/10 pt-10 text-center sm:grid-cols-3">
            <div>
              <p className="text-3xl font-extrabold text-amber-400">100+</p>
              <p className="text-sm text-slate-300">Businesses, tutors &amp; teams using Kudos</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-amber-400">£2.50</p>
              <p className="text-sm text-slate-300">Cards from, incl. VAT (+ postage)</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-amber-400">&lt;10 min</p>
              <p className="text-sm text-slate-300">Average setup time</p>
            </div>
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Choose your membership</h2>
          {/* Bulk sending leads, because it's what a membership is actually for
              and it's what the "Send in bulk" buttons in the card library
              promise. Anyone arriving from one should land on the same message
              they clicked, not a bare price list. */}
          <p className="mt-3 text-lg font-medium text-slate-700">
            Send one card, or one to every student — from a single list.
          </p>
          <p className="mt-3 text-slate-600">
            Upload your recipients once and every card is personalised with their own name, then
            printed and posted for you. Every plan includes the dashboard, card shop and birthday
            calendar. Cards are billed per order (card price incl. VAT + a stamp per card: 1st class
            £1.80, 2nd class £0.91).
          </p>
        </div>
        {/* No `items-start`: the three cards stretch to a common height so their
            feature lists can differ in length without the boxes going ragged.
            Each card's CTA is pinned to the bottom with `mt-auto`. */}
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PLAN_CATALOG.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col gap-4 rounded-2xl p-6 ring-1 ${
                plan.highlight ? "bg-white shadow-xl ring-2" : "bg-white shadow-sm ring-slate-100"
              }`}
              style={
                plan.highlight
                  ? { borderColor: CORAL, boxShadow: "0 10px 40px rgba(239,91,82,0.15)" }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  <p className="text-xs text-slate-500">{plan.tagline}</p>
                </div>
                {plan.highlight && (
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: CORAL }}
                  >
                    Most popular
                  </span>
                )}
              </div>
              <p>
                <span className="text-3xl font-extrabold">
                  {formatPlanPrice(plan.monthlyPriceMinor)}
                </span>
                <span className="text-slate-500">/mo</span>
              </p>
              <p className="text-sm font-medium text-emerald-600">{planCardPriceLabel(plan)}</p>
              <ul className="flex flex-col gap-2 text-sm text-slate-600">
                {plan.inherits && <li className="font-medium text-slate-500">{plan.inherits}</li>}
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-emerald-500">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.id === "free" ? "/register" : `/register?plan=${plan.id}`}
                className={`mt-auto rounded-full px-5 py-2.5 text-center font-semibold transition-opacity hover:opacity-90 ${
                  plan.highlight ? "text-white" : "border border-slate-200 text-slate-900"
                }`}
                style={plan.highlight ? { backgroundColor: CORAL } : undefined}
              >
                {plan.id === "free" ? "Start free" : `Choose ${plan.name}`}
              </Link>
            </div>
          ))}
        </div>

        {/* Enterprise — a "Contact us" tier, distinct from the self-serve plans. */}
        <div className="mt-6 flex flex-col items-start justify-between gap-5 rounded-2xl bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:p-8">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold">{ENTERPRISE_PLAN.name}</h3>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-slate-200">
                {ENTERPRISE_PLAN.priceLabel} pricing
              </span>
            </div>
            <p className="max-w-xl text-sm text-slate-300">
              {ENTERPRISE_PLAN.tagline}. Volume card pricing, multiple sites and unlimited seats,
              onboarding and a dedicated account manager.
            </p>
          </div>
          <Link
            href={ENTERPRISE_PLAN.ctaHref}
            className="shrink-0 rounded-full bg-white px-6 py-3 font-semibold text-slate-900 transition-opacity hover:opacity-90"
          >
            {ENTERPRISE_PLAN.ctaLabel} →
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-b from-white to-sky-50">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Never miss a moment that matters</h2>
          <p className="mt-3 text-slate-600">
            Send your first card in minutes. Or set it up once and let Kudos Cards look after the
            rest of the year for you.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-block rounded-full px-8 py-3 font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: CORAL }}
          >
            Start for free, no card needed
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Logo className="h-20 w-auto" />
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} Kudos Cards Ltd. The company that allows you to give some
            Kudos.
          </p>
          <div className="flex flex-col items-center gap-4 sm:items-end">
            <SocialLinks className="text-slate-500" />
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-slate-600 sm:justify-end">
              <Link href="/login" className="hover:text-slate-900">
                Log in
              </Link>
              <Link href="/register" className="hover:text-slate-900">
                Register
              </Link>
              <Link href="/for" className="hover:text-slate-900">
                Who it&apos;s for
              </Link>
              <Link href="/guides" className="hover:text-slate-900">
                Guides
              </Link>
              <Link href="/faq" className="hover:text-slate-900">
                FAQ
              </Link>
              <Link href="/terms" className="hover:text-slate-900">
                Terms &amp; Conditions
              </Link>
              <Link href="/privacy" className="hover:text-slate-900">
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
