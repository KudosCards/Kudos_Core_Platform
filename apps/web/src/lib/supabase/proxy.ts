import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "../env";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptionsWithName;
}

const PUBLIC_PATHS = ["/", "/login", "/register"];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    // Public recipient message pages (/r/<slug>).
    pathname.startsWith("/r/") ||
    // The public card library: visitors browse /cards and /cards/<id> with no
    // account, and buy a one-off card via the guest flow (/cards/<id>/send).
    // See docs/adr/0017-public-card-library.md and 0025.
    pathname === "/cards" ||
    pathname.startsWith("/cards/") ||
    // The guest basket — a one-off visitor fills it and checks out with no
    // account (POST /guest/cart-checkout). See docs/adr/0025.
    pathname === "/basket" ||
    // Guest checkout's Stripe return pages — the buyer has no session.
    pathname.startsWith("/gift/") ||
    // Team invite acceptance — an invited colleague may not have a login yet,
    // so the accept page authenticates them itself. See docs/adr/0028.
    pathname.startsWith("/invite/")
  );
}

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated users away from the authenticated app shell. Following
 * the official @supabase/ssr Next.js middleware pattern.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Read the session with getSession, NOT getUser. getUser() hits Supabase's
  // Auth server on every request — a blocking network round-trip on every page
  // navigation, which is the single biggest source of sluggish page-to-page
  // navigation. getSession() reads (and, when the cookie carries a valid
  // refresh token, silently refreshes) the session locally, only touching the
  // network when the access token actually needs refreshing.
  //
  // This is safe here because the middleware is only a UX redirect gate, not
  // the security boundary: the NestJS API cryptographically verifies every
  // token against Supabase's JWKS on every call, and the authenticated layout's
  // /accounts/me fetch redirects to /login on a 401. A stale or forged cookie
  // that slips past this gate therefore renders nothing — the API rejects it
  // one hop later, before any data is fetched. See docs/adr/0023-navigation-performance.md.
  //
  // Wrapped so a transient auth failure can never crash the edge function:
  // navigation gating fails open, and the app shell re-checks server-side.
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session && !isPublicPath(request.nextUrl.pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    }
  } catch {
    // Don't take the whole site down on an auth hiccup — let the request
    // through; the authenticated layout re-checks the session and redirects.
  }

  return response;
}
