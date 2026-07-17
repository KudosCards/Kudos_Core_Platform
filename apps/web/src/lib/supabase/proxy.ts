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

  // Validate the JWT locally against the project's (cached) JWKS via
  // getClaims. With asymmetric signing keys — which this project uses
  // (ES256, same JWKS the API verifies against) — this is a WebCrypto check
  // with no per-request network round-trip to the Auth server, unlike
  // getUser(). It transparently refreshes a near-expiry session first (the
  // cookie write is captured by setAll above) and only falls back to a
  // network validation if the project ever switched to a symmetric secret,
  // so it is never slower than getUser and much faster in the common case.
  // Real authorization is still enforced server-side by the API; this proxy
  // only gates navigation and keeps the session cookie fresh.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);

  if (!isAuthenticated && !isPublicPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
