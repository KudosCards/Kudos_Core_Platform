import Link from "next/link";
import type { Metadata } from "next";
import { ENTERPRISE_PLAN } from "@kudos/shared-types";
import { PublicHeader } from "@/components/public-header";
import { SocialLinks } from "@/components/social-links";
import { EnterpriseContactForm } from "./enterprise-contact-client";

/**
 * The public Enterprise "Contact us" page, reached from the Enterprise option on
 * the pricing tables (landing + in-app billing). Deliberately its own light
 * marketing look, like the landing page. See ADR 0101.
 */
export const metadata: Metadata = {
  title: "Kudos Cards for Enterprise — talk to our team",
  description:
    "Volume card pricing, multiple sites, unlimited seats and a dedicated account manager. Tell us what your organisation needs.",
};

export default function EnterprisePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <PublicHeader
        navLinks={[
          { href: "/#how", label: "How it works" },
          { href: "/cards", label: "Card library" },
          { href: "/#plans", label: "Plans" },
        ]}
      />

      <section className="bg-gradient-to-b from-sky-50 to-white">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-6 py-16 md:grid-cols-2 md:py-20">
          <div className="flex flex-col gap-6">
            <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-100">
              Enterprise
            </span>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Kudos at scale for your whole organisation
            </h1>
            <p className="max-w-lg text-lg text-slate-600">
              Running multiple sites, a franchise, or thousands of contacts? We&apos;ll tailor
              pricing and setup around your organisation — tell us what you need and we&apos;ll take
              it from there.
            </p>

            <ul className="flex flex-col gap-3">
              {ENTERPRISE_PLAN.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-slate-700">
                  <span className="mt-0.5 text-emerald-500">✓</span>
                  {feature}
                </li>
              ))}
            </ul>

            <p className="text-sm text-slate-500">
              Not sure you need Enterprise yet?{" "}
              <Link href="/#plans" className="font-medium text-slate-700 underline hover:text-slate-900">
                Compare all plans
              </Link>
              .
            </p>
          </div>

          <div className="md:pt-4">
            <EnterpriseContactForm />
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} Kudos Cards Ltd. The company that allows you to give some
            Kudos.
          </p>
          <div className="flex items-center gap-4">
            <SocialLinks className="text-slate-500" />
            <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
