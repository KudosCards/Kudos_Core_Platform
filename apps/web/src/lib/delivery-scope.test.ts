import type { Metadata } from "next";
import { organisationSchema, cardProductSchema } from "./structured-data";
import { FAQ_ENTRIES } from "./faq";
import { DELIVERY_COUNTRY_CODE, DELIVERY_COUNTRY_NAME, NOT_A_UK_POSTCODE } from "./delivery-scope";

/**
 * Two facts that have to stay together: cards are posted to UK addresses, and
 * the person sending one can be anywhere. The site said neither for a long time
 * and then said the first as an error message, at the address field, after
 * somebody had signed up and chosen a card.
 *
 * See docs/uk-scope-messaging-plan.md.
 */
describe("delivery scope", () => {
  describe("what the markup claims", () => {
    it("states the service area on the organisation, which said nothing before", () => {
      expect(organisationSchema()).toMatchObject({
        areaServed: { "@type": "Country", name: DELIVERY_COUNTRY_NAME },
      });
    });

    it("keeps the registered office separate from the service area", () => {
      // They are the same country and different facts. A search engine should
      // not have to infer where we deliver from where we are incorporated, and
      // the day the company moves, only one of these should change.
      const schema = organisationSchema() as Record<string, unknown>;
      expect(schema.address).not.toHaveProperty("areaServed");
      expect(schema).toHaveProperty("areaServed");
    });

    it("agrees with the product-level shipping destination", () => {
      // The Offer already carried this. Two claims about one fact, so they read
      // from one constant — the file's whole rule is that markup must not
      // assert anything checkout would contradict, and it cannot hold that line
      // if it disagrees with itself.
      const product = cardProductSchema(cardFixture(), "A birthday card.") as {
        offers: { shippingDetails: { shippingDestination: { addressCountry: string } } };
      };
      expect(product.offers.shippingDetails.shippingDestination.addressCountry).toBe(
        DELIVERY_COUNTRY_CODE,
      );
    });
  });

  describe("what we say before anyone gets that far", () => {
    // S4 and S5. The refusal below is the last place this should be learned,
    // not the first — these two are the first.

    it("names the delivery scope in the search result", async () => {
      // A third of last week's visitors were outside the UK and nothing in the
      // homepage title, description or OpenGraph mentioned where we post.
      const { metadata } = (await import("@/app/page")) as { metadata: Metadata };
      expect(metadata.description).toMatch(/UK addresses/i);
      expect(metadata.openGraph?.description).toMatch(/UK addresses/i);
    });

    it("answers the question a visitor from abroad actually has", () => {
      const entry = FAQ_ENTRIES.find((e) => /outside the UK/i.test(e.question));
      expect(entry).toBeDefined();

      const answer = entry!.answer.join(" ");
      // Both halves, because either alone is misleading: "UK only" loses a
      // customer we already serve, and "send from anywhere" without naming the
      // destination is the silence that made the refusal a surprise.
      expect(answer).toMatch(/any country|anywhere/i);
      expect(answer).toMatch(/destination .* in the UK|has to be in the UK/i);
    });

    it("tells a distant sender the thing only they need to know", () => {
      // The cut-off is a UK local hour (`sameDayCutoffHour`) against
      // PLATFORM_TIME_ZONE "Europe/London", so an order placed late in the
      // American evening is already tomorrow here. It is the single most
      // useful sentence on the page for somebody in California, and the FAQ's
      // own rule is that every answer is something the product actually does.
      const entry = FAQ_ENTRIES.find((e) => /outside the UK/i.test(e.question));
      expect(entry!.answer.join(" ")).toMatch(/UK time/i);
    });
  });

  describe("what we tell somebody we cannot deliver to", () => {
    it("names our scope rather than their mistake", () => {
      // The old wording was "That doesn't look like a valid UK postcode." They
      // did not mistype. They did not know, because we never said.
      expect(NOT_A_UK_POSTCODE).toMatch(/UK addresses only/i);
      expect(NOT_A_UK_POSTCODE).not.toMatch(/doesn't look like|invalid|valid UK postcode/i);
    });

    it("says the restriction is on the destination, not on them", () => {
      // The sentence that keeps a customer we already serve: Stripe Checkout
      // has no allowed_countries and sign-up asks for no country, so somebody
      // in New York sending to Leeds is not an edge case, they are a customer.
      expect(NOT_A_UK_POSTCODE).toMatch(/order from anywhere/i);
      expect(NOT_A_UK_POSTCODE).toMatch(/delivery address/i);
    });

    it("never claims we only serve UK customers, which is false", () => {
      expect(NOT_A_UK_POSTCODE).not.toMatch(/UK (customers|only customers|residents)/i);
    });
  });
});

function cardFixture() {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    name: "Birthday Stars",
    slug: "birthday-stars",
    category: "birthday",
    occasion: "birthday",
    imageUrl: "https://storage.test/card.png",
  } as unknown as Parameters<typeof cardProductSchema>[0];
}
