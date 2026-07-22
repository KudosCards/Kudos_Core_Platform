import Image from "next/image";
import Link from "next/link";

const CORAL = "#ef5b52";

/** The marketing-styled header shared by the public card library pages, matching
 * the landing page's look (not the app shell). */
export function CardsHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/">
          <Image
            src="/marketing/logo.png"
            alt="Kudos Cards"
            width={410}
            height={475}
            className="h-14 w-auto"
            priority
          />
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
          <Link href="/cards" className="hover:text-slate-900">
            Card library
          </Link>
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
  );
}
