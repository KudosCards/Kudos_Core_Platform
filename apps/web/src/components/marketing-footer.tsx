import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal";

/**
 * The compact footer for the standalone public content pages (/faq, /for/*).
 *
 * Deliberately not the homepage footer: that one carries the logo, the social
 * links and the strapline and belongs to the landing page. This is the
 * everything-else footer — the legal links a public page must carry, plus a way
 * back into the site. Shared so a third content page doesn't copy it again.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-slate-500 sm:flex-row">
        <p>© {new Date().getFullYear()} Kudos Cards Ltd</p>
        <nav className="flex flex-wrap justify-center gap-4">
          <Link href="/cards" className="hover:text-slate-900">
            Card library
          </Link>
          <Link href="/for" className="hover:text-slate-900">
            Who it&apos;s for
          </Link>
          <Link href="/faq" className="hover:text-slate-900">
            FAQ
          </Link>
          <Link href={LEGAL_LINKS.terms.href} className="hover:text-slate-900">
            {LEGAL_LINKS.terms.label}
          </Link>
          <Link href={LEGAL_LINKS.privacy.href} className="hover:text-slate-900">
            {LEGAL_LINKS.privacy.label}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
