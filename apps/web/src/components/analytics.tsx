import Script from "next/script";
import { env } from "@/lib/env";
import { CONSENT_STORAGE_KEY } from "@/lib/consent";

/**
 * Google Analytics (GA4) behind Consent Mode v2, loaded via next/script rather
 * than a raw <script> pasted into the document head.
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
      {/*
        Order is the whole correctness argument here, so it is worth stating.

        `consent default` MUST be pushed before `config`. gtag applies whatever
        consent state exists at the moment a measurement call runs, so a config
        that lands first is measured under the implied default of granted — and
        that first pageview is exactly the one a cookie banner exists to
        prevent. Everything below is a single script for that reason: split
        across two, the ordering becomes a race.

        The stored choice is read synchronously, before anything is pushed, so a
        returning visitor who accepted is not briefly denied. `wait_for_update`
        gives the banner a moment to grant on a first visit before gtag decides,
        so an immediate accept still counts that pageview.
      */}
      <Script id="google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
var kudosConsent = null;
try { kudosConsent = window.localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)}); } catch (e) {}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: kudosConsent === 'granted' ? 'granted' : 'denied',
  wait_for_update: 500
});
gtag('js', new Date());
gtag('config', ${JSON.stringify(measurementId)});`}
      </Script>
    </>
  );
}
