import Script from "next/script";
import { env } from "@/lib/env";

/**
 * Google Analytics (GA4), loaded via next/script rather than a raw <script>
 * pasted into the document head.
 *
 * `afterInteractive` is the right strategy for gtag: it must run on every page
 * but it isn't needed to render one, so it loads once hydration is underway and
 * never blocks first paint. A raw tag in the App Router would fight the
 * router — hoisting is undefined and it wouldn't survive client-side
 * navigations, which is most of this app.
 *
 * Nothing renders when the measurement id is unset, which is deliberate: it's
 * set only for Netlify's production context (see netlify.toml), so localhost
 * and deploy previews don't report developer traffic as real visits.
 *
 * GA4's enhanced measurement tracks History API changes by default, so the
 * client-side route changes Next makes are counted without extra wiring here.
 */
export function Analytics() {
  const measurementId = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!measurementId) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');`}
      </Script>
    </>
  );
}
