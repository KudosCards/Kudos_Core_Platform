import Image from "next/image";
import Link from "next/link";

/**
 * Public marketing landing — the page web traffic lands on. Sells the
 * membership and funnels visitors into sign up / log in → the customer app.
 * Deliberately light-committed (its own brand look), independent of the app's
 * light/dark theme. Assets live in /public/marketing (from the repo /images).
 */

const CORAL = "#ef5b52";

const usedBy = [
  "Tuition Centres",
  "Music Schools",
  "Sports Academies",
  "After-School Clubs",
  "Private Tutors",
];

const pains = [
  "Birthday spreadsheets that nobody remembers to check",
  "Students whose birthdays are missed — and parents who notice",
  "Wasted hours shopping for cards, writing, stamping, posting",
  "Retention suffering because students don't feel valued",
];

const steps = [
  {
    step: "01",
    title: "Upload your contacts",
    body: "Import your student list with their dates of birth — from a spreadsheet or by hand. Takes less than 5 minutes for most centres.",
  },
  {
    step: "02",
    title: "Birthdays tracked automatically",
    body: "Our system watches the calendar for you. You'll get a notification ahead of each birthday — or let it run fully on autopilot.",
  },
  {
    step: "03",
    title: "We print and post the card",
    body: "Choose from our range of card designs. We handle the printing, packing and posting. A real card arrives at the student's home.",
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
    title: "Stronger student loyalty",
    body: "Pupils who feel valued don't look for alternatives.",
  },
  {
    title: "Delighted parents",
    body: "A card at home becomes a talking point and earns referrals.",
  },
  {
    title: "Hours saved every month",
    body: "Zero admin, zero trips to the card shop.",
  },
  {
    title: "Win back lapsed students",
    body: "A simple birthday card can be the reason a family comes back.",
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

const plans = [
  {
    name: "Free",
    price: "£0",
    cadence: "/mo",
    cardPrice: "£1.50 / card",
    features: ["Up to 50 contacts", "Full card designer", "Manual approve & send", "Community support"],
    highlight: false,
  },
  {
    name: "Pro",
    price: "£9.97",
    cadence: "/mo",
    cardPrice: "£1.35 / card (10% off)",
    features: [
      "Up to 200 contacts",
      "10% off every card",
      "Auto-send birthdays",
      "Priority support",
    ],
    highlight: true,
  },
  {
    name: "Centre",
    price: "£19.97",
    cadence: "/mo",
    cardPrice: "£1.28 / card (15% off)",
    features: [
      "Unlimited contacts",
      "15% off every card",
      "Full automation & scale",
      "Dedicated support",
    ],
    highlight: false,
  },
];

function Wordmark() {
  return (
    <span className="text-xl font-extrabold tracking-tight">
      <span style={{ color: CORAL }}>kudos</span>
      <span className="text-amber-500"> cards</span>
    </span>
  );
}

function Stars() {
  return <span className="text-amber-400">★★★★★</span>;
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#how" className="hidden hover:text-slate-900 sm:inline">
              How it works
            </a>
            <a href="#plans" className="hidden hover:text-slate-900 sm:inline">
              Plans
            </a>
            <Link href="/login" className="hover:text-slate-900">
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-full px-4 py-2 font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: CORAL }}
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-sky-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:grid-cols-2 md:py-24">
          <div className="flex flex-col gap-6">
            <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-100">
              🟢 Trusted by tutors, schools &amp; clubs across the UK
            </span>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Automated Birthday Cards for Tuition Centres, Schools &amp; Clubs
            </h1>
            <p className="text-xl font-semibold text-slate-700">
              You upload the contacts. We send the cards.
            </p>
            <p className="max-w-lg text-slate-600">
              Kudos Cards tracks every student&apos;s birthday and posts a personalised printed card
              on your behalf — automatically, every year. No admin. No forgotten birthdays. No trips
              to the post office.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/register"
                className="rounded-full px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: CORAL }}
              >
                Start Free — No Card Needed
              </Link>
              <a href="#how" className="text-sm font-medium text-slate-600 underline hover:text-slate-900">
                See how it works ↓
              </a>
            </div>
            <div className="mt-2 w-fit rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <Stars />
              <p className="mt-1 max-w-sm text-sm text-slate-600 italic">
                &quot;Set it up in 10 minutes. Cards just go out. Parents message us to say thank you —
                that never happened before.&quot;
              </p>
              <p className="mt-1 text-sm font-semibold">Sarah T. — Tuition Centre Owner, Manchester</p>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <Image
              src="/marketing/card-birthday.png"
              alt="A personalised Happy Birthday card"
              width={300}
              height={450}
              className="mx-auto w-full rounded-xl shadow-2xl ring-1 ring-slate-100"
              priority
            />
            <div className="absolute -bottom-4 -left-4 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-100">
              <p className="text-sm font-semibold">Card sent to Jack ✓</p>
              <p className="text-xs text-slate-500">Printed &amp; posted automatically</p>
            </div>
          </div>
        </div>
        {/* Used by */}
        <div className="mx-auto max-w-6xl px-6 pb-10">
          <p className="text-center text-xs font-semibold tracking-widest text-slate-400 uppercase">
            Used by
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {usedBy.map((who) => (
              <span
                key={who}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600"
              >
                {who}
              </span>
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
        />
        <div className="flex flex-col gap-5">
          <span className="w-fit rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
            SOUND FAMILIAR?
          </span>
          <h2 className="text-3xl font-bold tracking-tight">Managing student birthdays is painful</h2>
          <p className="text-slate-600">
            Most tuition centres mean well — but without a system, important moments slip through the
            cracks.
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
            ✓ Kudos Cards fixes all of this automatically — in under 10 minutes to set up.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
              SIMPLE BY DESIGN
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight">Up and running in three steps</h2>
            <p className="mt-3 text-slate-600">
              No technical knowledge needed. If you can upload a spreadsheet, you can use Kudos Cards.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.step} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
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
            Personalised with every student&apos;s name
          </h2>
          <p className="text-slate-600">
            Your centre&apos;s message, printed inside — automatically. Pick a design from our range,
            add a QR code that links to a personal message from the team, and we do the rest.
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
                />
                <span className="text-xs text-slate-500">{cat.label}</span>
              </div>
            ))}
          </div>
        </div>
        <Image
          src="/marketing/card-welldone.png"
          alt="A personalised Well Done card"
          width={300}
          height={450}
          className="mx-auto w-full max-w-xs rounded-xl shadow-2xl ring-1 ring-slate-100"
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
              Students who feel remembered stay longer
            </h2>
            <p className="text-slate-600">
              A physical birthday card does something no text message or email ever can — it shows you
              genuinely cared enough to send something real.
            </p>
            <ul className="flex flex-col gap-4">
              {benefits.map((b) => (
                <li key={b.title} className="flex items-start gap-3">
                  <span className="text-emerald-500">✓</span>
                  <span>
                    <span className="font-semibold">{b.title}</span>{" "}
                    <span className="text-slate-600">— {b.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/register"
              className="w-fit rounded-full px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: CORAL }}
            >
              Start Free — No Credit Card Needed
            </Link>
          </div>
          <Image
            src="/marketing/card-shop.png"
            alt="The Kudos Cards card shop"
            width={1274}
            height={618}
            className="w-full rounded-xl shadow-xl ring-1 ring-slate-100"
          />
        </div>
      </section>

      {/* Reviews + stats (dark) */}
      <section className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="rounded-full bg-amber-400/20 px-3 py-1 text-xs font-semibold text-amber-300">
              VERIFIED REVIEWS
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight">Don&apos;t take our word for it</h2>
            <p className="mt-3 text-slate-300">
              Real feedback from tutors, centre owners and club managers across the UK.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {reviews.map((r) => (
              <div key={r.name} className="flex flex-col gap-3 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                <Stars />
                <p className="text-sm text-slate-200">{r.body}</p>
                <p className="mt-auto text-sm font-semibold">{r.name}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 grid gap-6 border-t border-white/10 pt-10 text-center sm:grid-cols-3">
            <div>
              <p className="text-3xl font-extrabold text-amber-400">100+</p>
              <p className="text-sm text-slate-300">Tutors &amp; centres using Kudos</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-amber-400">£1.50</p>
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
      <section id="plans" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Choose your membership</h2>
          <p className="mt-3 text-slate-600">
            Every plan includes the dashboard, card shop and birthday calendar. Cards are billed per
            order (card price incl. VAT + a stamp per card: 1st class £1.80, 2nd class £0.91).
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col gap-4 rounded-2xl p-6 ring-1 ${
                plan.highlight
                  ? "bg-white shadow-xl ring-2"
                  : "bg-white shadow-sm ring-slate-100"
              }`}
              style={plan.highlight ? { borderColor: CORAL, boxShadow: "0 10px 40px rgba(239,91,82,0.15)" } : undefined}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{plan.name}</h3>
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
                <span className="text-3xl font-extrabold">{plan.price}</span>
                <span className="text-slate-500">{plan.cadence}</span>
              </p>
              <p className="text-sm font-medium text-emerald-600">{plan.cardPrice}</p>
              <ul className="flex flex-col gap-2 text-sm text-slate-600">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="text-emerald-500">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={`mt-auto rounded-full px-5 py-2.5 text-center font-semibold transition-opacity hover:opacity-90 ${
                  plan.highlight ? "text-white" : "border border-slate-200 text-slate-900"
                }`}
                style={plan.highlight ? { backgroundColor: CORAL } : undefined}
              >
                {plan.name === "Free" ? "Start free" : `Choose ${plan.name}`}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-b from-white to-sky-50">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Never miss a student&apos;s birthday again
          </h2>
          <p className="mt-3 text-slate-600">
            Set it up in under 10 minutes and let Kudos Cards run on autopilot for the rest of the
            year.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-block rounded-full px-8 py-3 font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: CORAL }}
          >
            Start Free — No Card Needed
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Wordmark />
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} Kudos Cards Ltd. The company that allows you to give some
            Kudos.
          </p>
          <div className="flex gap-4 text-sm text-slate-600">
            <Link href="/login" className="hover:text-slate-900">
              Log in
            </Link>
            <Link href="/register" className="hover:text-slate-900">
              Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
