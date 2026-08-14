import Link from "next/link";
import Image from "next/image";
import { LEGAL_LINKS } from "@/lib/legal";

/**
 * Public chrome for the legal pages (/terms, /privacy). Deliberately simple — a
 * home link in the header and a footer that cross-links the two documents — so
 * the content is the focus and the pages are reachable when logged out.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-white">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="shrink-0" aria-label="Kudos Cards home">
            <Image
              src="/marketing/logo.png"
              alt="Kudos Cards"
              width={410}
              height={475}
              className="h-11 w-auto sm:h-12"
              priority
            />
          </Link>
          <Link href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Back to home
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Kudos Cards Ltd</p>
          <nav className="flex gap-4">
            <Link href={LEGAL_LINKS.terms.href} className="hover:text-slate-900">
              {LEGAL_LINKS.terms.label}
            </Link>
            <Link href={LEGAL_LINKS.privacy.href} className="hover:text-slate-900">
              {LEGAL_LINKS.privacy.label}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
