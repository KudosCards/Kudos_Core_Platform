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
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/r/");
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

  // Refresh + validate the session with getUser — the proven @supabase/ssr
  // pattern. (A previous getClaims()-based optimisation crashed Netlify's
  // Edge runtime — "edge function invocation failed" — so this is deliberately
  // the boring, known-good call.) Wrapped so a transient auth failure can
  // never crash the edge function: navigation gating fails open, and the app
  // shell still enforces auth server-side (its /accounts/me fetch redirects to
  // /login when there's no session), so nothing sensitive is exposed.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isPublicPath(request.nextUrl.pathname)) {
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
