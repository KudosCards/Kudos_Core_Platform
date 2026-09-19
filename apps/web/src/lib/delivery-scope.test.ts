import { organisationSchema, cardProductSchema } from "./structured-data";
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
