import { PLAN_CATALOG } from "@kudos/shared-types";
import {
  CLICK_AND_FORGET_FOOTNOTE,
  CLICK_AND_FORGET_PLAN,
  CLICK_AND_FORGET_POINTS,
} from "./click-and-forget";
import { FAQ_ENTRIES } from "./faq";

/**
 * Click and forget asks a customer to hand over their birthdays and stop
 * watching. What the marketing says about it is therefore a promise, not a
 * pitch, and these are the parts of that promise that would be expensive to
 * get wrong: the plan it needs, and the two things we do not do.
 *
 * See docs/adr/0261.
 */
describe("click and forget copy", () => {
  const faqText = (pattern: RegExp) => {
    const entry = FAQ_ENTRIES.find((candidate) => pattern.test(candidate.question));
    expect(entry).toBeDefined();
    return entry!.answer.join(" ");
  };

  describe("the plan it names", () => {
    it("is the plan whose features carry auto-send", () => {
      // Auto-send is a plan entitlement. If it ever moves tier, the page must
      // move with it rather than keep selling a feature the named plan no
      // longer includes.
      expect(CLICK_AND_FORGET_PLAN.features.join(" ")).toMatch(/auto-send/i);
    });

    it("is the cheapest plan that carries it", () => {
      // "On Pro and above" is only true if nothing below Pro has it. The
      // catalog is in upgrade order, so the first match is the floor.
      const floor = PLAN_CATALOG.find((plan) => /auto-send/i.test(plan.features.join(" ")));
      expect(floor).toBe(CLICK_AND_FORGET_PLAN);
    });

    it("says so in the footnote, from the catalog rather than a typed name", () => {
      expect(CLICK_AND_FORGET_FOOTNOTE).toContain(`On ${CLICK_AND_FORGET_PLAN.name} and above`);
    });

    it("agrees with the FAQ", () => {
      // Two pages answering the same question with different plan names is how
      // a customer ends up paying for the wrong one.
      expect(faqText(/set it up once/i)).toContain(CLICK_AND_FORGET_PLAN.name);
    });
  });

  describe("what it promises", () => {
    it("says the customer picks the cards and writes the messages", () => {
      // The honesty line, and the answer to the obvious fear about handing
      // sending over. It is said on the homepage and in the FAQ on purpose.
      expect(CLICK_AND_FORGET_FOOTNOTE).toMatch(/you choose the cards and write the messages/i);
      expect(faqText(/set it up once/i)).toMatch(/you choose the cards and write the messages/i);
    });

    it("promises we say something when a card does not go", () => {
      // C1 and C2 are what make this true: a skip notice for every reason a
      // card is not sent, and a warning before the balance runs out.
      const points = CLICK_AND_FORGET_POINTS.map((point) => `${point.title} ${point.body}`).join(
        " ",
      );
      expect(points).toMatch(/you hear about it|we tell you/i);
      expect(faqText(/how do I know it worked/i)).toMatch(/no postal address/i);
      expect(faqText(/how do I know it worked/i)).toMatch(/balance/i);
    });

    it("describes varying the cards, not matching them to people", () => {
      // The catalog age bands and tones exist, but the designs have not been
      // described yet (docs/ops/catalog-describe-designs.md), so a card is
      // varied rather than chosen to suit anyone. Saying otherwise would be
      // selling the ops pass we have not done.
      const everything = [
        CLICK_AND_FORGET_FOOTNOTE,
        ...CLICK_AND_FORGET_POINTS.map((point) => point.body),
        faqText(/set it up once/i),
      ].join(" ");
      expect(everything).toMatch(/vary|varies/i);
      expect(everything).not.toMatch(/suits? (each|every|the) (person|recipient)|right card for/i);
    });

    it("never claims we write the messages", () => {
      // `source: "assisted"` is recorded and nothing writes it. Until a vendor
      // and a data-processing agreement exist, this is not a thing we do.
      const everything = [
        CLICK_AND_FORGET_FOOTNOTE,
        ...CLICK_AND_FORGET_POINTS.map((point) => point.body),
        faqText(/set it up once/i),
        faqText(/how do I know it worked/i),
      ].join(" ");
      expect(everything).not.toMatch(/written for you|we write (the |your )?messages/i);
      // Case-sensitive and bounded: "again" contains "ai".
      expect(everything).not.toMatch(/\bAI\b/);
    });
  });
});
