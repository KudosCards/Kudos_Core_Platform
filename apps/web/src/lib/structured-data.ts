import { CARD_PRICE_MINOR, POSTAGE_MINOR } from "@kudos/shared-types";
import type { CardDesign } from "@kudos/shared-types";
import { SITE_URL, absoluteUrl } from "./site";

/**
 * JSON-LD payloads, built in one place so every claim traces back to a constant
 * or to the registered company details rather than to a hand-typed string.
 *
 * The rule for this file: never assert anything here that the product doesn't do
 * or that checkout would contradict. A price in `Offer` that disagrees with what
 * we charge is worse than no markup at all — Google drops the rich result and
 * the customer sees a bait-and-switch. See docs/seo-plan.md (Phase 3).
 */

/** Company facts, from lib/legal (the registered details we already publish). */
const LEGAL_NAME = "Kudos Cards Ltd";
const COMPANY_NUMBER = "16349929";
const CONTACT_EMAIL = "info@kudoscards.co.uk";

const SOCIAL_PROFILES = [
  "https://www.linkedin.com/company/kudos-cards",
  "https://www.instagram.com/kudos_cards",
  "https://youtube.com/@kudoscardsuk",
];

/** Stable @id so Product/Breadcrumb nodes can point at the same organisation. */
const ORGANISATION_ID = `${SITE_URL}/#organisation`;

export function organisationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANISATION_ID,
    name: "Kudos Cards",
    legalName: LEGAL_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/marketing/logo.png"),
    email: CONTACT_EMAIL,
    description:
      "Real, personalised cards, printed and posted for you — so you never miss a birthday, thank-you or milestone.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Darlington",
      postalCode: "DL1 1GB",
      addressCountry: "GB",
    },
    // Companies House number. `identifier` rather than `taxID`/`vatID` — it's a
    // registration number, not a tax reference, and we shouldn't imply one.
    identifier: {
      "@type": "PropertyValue",
      name: "Companies House company number",
      value: COMPANY_NUMBER,
    },
    sameAs: SOCIAL_PROFILES,
  };
}

export function webSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: "Kudos Cards",
    publisher: { "@id": ORGANISATION_ID },
    inLanguage: "en-GB",
  };
}

/** `[{ name, path }]` → a BreadcrumbList with absolute item URLs. */
export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/**
 * A card design as a Product.
 *
 * The Offer price is the card alone (`CARD_PRICE_MINOR`, VAT-inclusive), because
 * that's the line checkout charges for the card. Postage is a separate per-card
 * stamp, so it's declared as `shippingDetails` at the second-class rate — the
 * default and cheapest class, and the one the guest basket actually applies —
 * rather than being folded into the price. Both numbers come from
 * `packages/shared-types/src/pricing.ts`, so neither can drift from checkout.
 */
export function cardProductSchema(card: CardDesign, description: string) {
  const path = `/cards/${card.id}`;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: card.name,
    description,
    image: card.thumbnailUrl,
    category: card.category,
    brand: { "@type": "Brand", name: "Kudos Cards" },
    offers: {
      "@type": "Offer",
      url: absoluteUrl(path),
      price: (CARD_PRICE_MINOR / 100).toFixed(2),
      priceCurrency: "GBP",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": ORGANISATION_ID },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: (POSTAGE_MINOR.second_class / 100).toFixed(2),
          currency: "GBP",
        },
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: "GB",
        },
      },
    },
  };
}
