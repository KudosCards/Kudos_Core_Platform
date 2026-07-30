#!/usr/bin/env node
/**
 * One-shot Royal Mail Shipping API v4 sandbox check.
 *
 * Fires a SINGLE test shipment using the same request shape the app sends (see
 * src/shipping/royal-mail-client.ts — keep this in sync), so you can confirm the
 * wire format against your Royal Mail account BEFORE trusting live dispatch.
 * This is the "verify against the sandbox before go-live" step from ADR 0072.
 *
 * Usage:
 *   ROYAL_MAIL_API_KEY="<sandbox key>" \
 *   ROYAL_MAIL_API_BASE_URL="<sandbox base url from your RM onboarding>" \
 *   node scripts/royal-mail-sandbox-check.mjs
 *
 * Optional: RM_POSTAGE_CLASS=first_class (default second_class).
 *
 * Safety: refuses to run against the live host unless you pass --force-live, so
 * you can't accidentally buy real postage while testing.
 */

const LIVE_HOST = "https://api.parcel.royalmail.com";
// Placeholders — the exact codes are account-specific (ADR 0072). Verifying/
// correcting these is a large part of the point of this check.
const SERVICE_CODES = { first_class: "TPN01", second_class: "TPS01" };
const CARD_WEIGHT_GRAMS = 100;

const apiKey = process.env.ROYAL_MAIL_API_KEY;
const baseUrl = process.env.ROYAL_MAIL_API_BASE_URL;
const forceLive = process.argv.includes("--force-live");
const postageClass = process.env.RM_POSTAGE_CLASS === "first_class" ? "first_class" : "second_class";

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!apiKey) fail("Set ROYAL_MAIL_API_KEY to your Royal Mail SANDBOX key.");
if (!baseUrl) {
  fail("Set ROYAL_MAIL_API_BASE_URL to the Royal Mail sandbox base URL (from your RM onboarding docs).");
}
if (baseUrl.replace(/\/$/, "") === LIVE_HOST && !forceLive) {
  fail(
    `Refusing to run against the LIVE host (${LIVE_HOST}) — this would buy real postage.\n` +
      "  Point ROYAL_MAIL_API_BASE_URL at the sandbox, or pass --force-live if you truly mean it.",
  );
}

// A dummy test parcel — a real-format UK address so RM's validation passes.
const orderReference = `SANDBOX-TEST-${Date.now()}`;
const requestBody = {
  shipmentType: "Delivery",
  serviceCode: SERVICE_CODES[postageClass],
  shipmentReference: orderReference,
  recipientContact: { name: "Sandbox Test" },
  recipientAddress: {
    addressLine1: "1 Test Street",
    city: "Leeds",
    postcode: "LS1 1AA",
    countryCode: "GB",
  },
  packages: [{ weightInGrams: CARD_WEIGHT_GRAMS, packageType: "largeLetter" }],
};

const url = `${baseUrl.replace(/\/$/, "")}/api/v4/shipments`;
console.log(`→ POST ${url}`);
console.log(`→ serviceCode ${requestBody.serviceCode} (${postageClass}), ${CARD_WEIGHT_GRAMS}g largeLetter`);
console.log(`→ request body:\n${JSON.stringify(requestBody, null, 2)}\n`);

const response = await fetch(url, {
  method: "POST",
  headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(requestBody),
});

const raw = await response.text();
console.log(`← HTTP ${response.status} ${response.statusText}`);
console.log(`← response body:\n${raw}\n`);

if (!response.ok) {
  fail(
    `The sandbox rejected the shipment (HTTP ${response.status}). Compare the error above with the\n` +
      "  RM v4 docs — the usual culprits are the Authorization header format, the serviceCode\n" +
      "  (TPN01/TPS01 are placeholders), or the packages[].packageType / weightInGrams fields.",
  );
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  fail("Response wasn't JSON — double-check the base URL and /api/v4/shipments path.");
}

const trackingNumber = data.trackingNumber ?? data.shipmentTrackingNumber;
const labelUrl = data.labelUrl ?? data.label?.url ?? null;

if (!trackingNumber) {
  fail(
    "Shipment created, but no tracking number under `trackingNumber` / `shipmentTrackingNumber` —\n" +
      "  the response field name differs from what the app reads. Note the real field above and\n" +
      "  we'll map it in royal-mail-client.ts.",
  );
}

console.log(`✓ Success — tracking number: ${trackingNumber}`);
console.log(`✓ Label URL: ${labelUrl ?? "(none returned — check the label field name in the body above)"}`);
console.log(
  "\nIf the tracking number and label look right for your account, the live integration is verified\n" +
    "and safe to rely on. If either field name differed, tell me what the sandbox returned and I'll\n" +
    "correct the mapping / service codes in royal-mail-client.ts.",
);
