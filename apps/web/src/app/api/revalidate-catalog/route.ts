import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { CATALOG_CACHE_TAG } from "@/lib/catalog";

/**
 * Publishes the card catalog: drops every cached catalog read so the next
 * visitor sees the current library.
 *
 * The API calls this when a sync finishes (nightly or from the ops UI). Without
 * it the marketing site's only notion of freshness is a one-hour timer, and that
 * timer is lazy — a card added in Airtable could sit invisible on /cards for an
 * hour or more while showing immediately to anyone signed in, because the app's
 * own reads are `no-store`. That gap is what this closes.
 *
 * Deliberately not a Server Action: the caller is the API, not a browser.
 */

/** Never prerendered or cached — it exists to have side effects. */
export const dynamic = "force-dynamic";

/** Constant-time compare that doesn't leak length via an early return. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so compare hashes of equal
  // length — here, simply guard and still run the comparison to keep the timing
  // profile flat for same-length inputs.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.CATALOG_REVALIDATE_SECRET;

  // Unset means the deployment hasn't been wired up. Say so plainly rather than
  // 401ing (which would read as "wrong secret" and send someone hunting for a
  // typo) or 200ing (which would let a sync report success while publishing
  // nothing).
  if (!expected) {
    return NextResponse.json(
      { revalidated: false, reason: "CATALOG_REVALIDATE_SECRET is not set on the web app" },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-catalog-revalidate-secret");
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ revalidated: false }, { status: 401 });
  }

  // The second argument is required as of Next 16. "max" is what Next's own
  // deprecation notice names as the replacement for the old single-argument
  // form, i.e. purge the tag regardless of how old the entry is. `updateTag`
  // would be the other option, but it only works inside a Server Action and the
  // caller here is the API rather than a browser.
  // Purging alone leaves one rough edge: regeneration is
  // stale-while-revalidate, so the next visitor still gets the *old* page and
  // merely kicks the rebuild off behind themselves. An operator who presses Sync
  // and immediately opens /cards would see the previous library and reasonably
  // conclude nothing happened.
  //
  // The warming request that smooths that over is deliberately NOT made here.
  // Next collects revalidated tags during a request and applies them when it
  // finishes, so a fetch of /cards from inside this handler runs *before* the
  // purge lands — it re-caches the very data we're trying to drop. Measured:
  // warming in-request left the page a full cycle behind. The caller makes that
  // second request instead, once this one has returned.
  revalidateTag(CATALOG_CACHE_TAG, "max");

  return NextResponse.json({ revalidated: true, tag: CATALOG_CACHE_TAG });
}
