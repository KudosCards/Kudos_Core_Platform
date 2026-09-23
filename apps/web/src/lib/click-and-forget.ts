import { PLAN_CATALOG } from "@kudos/shared-types";

/**
 * The homepage's click-and-forget section — content, not markup, for the same
 * reason the FAQ is (see faq.ts): the claims are the part that can go wrong,
 * and prose sitting in JSX is prose nothing can check.
 *
 * Same two rules as the FAQ. The plan is resolved from the catalog rather than
 * typed out, and every line is something the product does today.
 */

/**
 * The plan click and forget needs. Auto-send is a plan entitlement
 * (`autoSendEnabled`), and the catalog is where that entitlement is described
 * to customers — so the page names the plan whose features carry it rather
 * than a string that has to be remembered when pricing moves.
 */
export const CLICK_AND_FORGET_PLAN = PLAN_CATALOG.find((candidate) => candidate.id === "pro")!;

export interface ClickAndForgetPoint {
  title: string;
  body: string;
}

/**
 * What click and forget actually does, in the customer's terms.
 *
 * Two things this deliberately does **not** say: that we choose a card to suit
 * each person (the catalog is still being described, and until it is we vary
 * the cards rather than match them), and anything about messages being written
 * for you. Both are real plans and neither is a fact yet. See docs/adr/0261.
 */
export const CLICK_AND_FORGET_POINTS: readonly ClickAndForgetPoint[] = [
  {
    title: "Your contacts, once",
    body: "Add them by hand, upload a spreadsheet, or sync them from the CRM you already use. Birthdays come with them.",
  },
  {
    title: "Your cards, your words",
    body: "Pick as many designs as you like and write a handful of messages. We vary them, so nobody gets the same card two years running.",
  },
  {
    title: "We tell you if anything stops",
    body: "A missing address, a card that came back, a balance running low — you hear about it. A birthday never passes in silence.",
  },
];

/**
 * The line under the section. It carries the plan gate and the promise that
 * nothing goes out unseen, which is the single most important sentence on the
 * page for somebody being asked to hand over their birthdays.
 */
export const CLICK_AND_FORGET_FOOTNOTE = `On ${CLICK_AND_FORGET_PLAN.name} and above. You choose the cards and write the messages, so nothing goes out in your name that you haven’t seen.`;
