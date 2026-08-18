import {
  CARD_PRICE_MINOR,
  CARD_SIZE_LABEL,
  DEFAULT_POSTAGE_LEAD_DAYS,
  PLAN_CATALOG,
  POSTAGE_MINOR,
  type PlanId,
} from "@kudos/shared-types";

/**
 * The public FAQ — content, not markup.
 *
 * Two rules, both load-bearing:
 *
 * 1. **Every number comes from a constant.** A FAQ that quotes £2.50 while
 *    checkout charges something else is worse than no FAQ, and it's the exact
 *    failure Phase 3 found twice on the send page. Prices, plan caps, card size
 *    and dispatch lead all resolve from `@kudos/shared-types`, so a change to
 *    the product rewrites the answer rather than dating it.
 * 2. **Every answer is something the product actually does**, traceable to a
 *    plan entitlement, a pricing constant or an ADR. Nothing aspirational, no
 *    invented figures — the same guardrail the homepage follows.
 *
 * `answer` is plain prose because the FAQPage JSON-LD is generated from these
 * exact strings (see structured-data.ts). Visible text and marked-up text are
 * the same text by construction; they cannot drift apart.
 */

export interface FaqEntry {
  question: string;
  /** Paragraphs. Joined with a space for the structured-data answer text. */
  answer: string[];
  /** Rendered under the answer, deliberately outside the markup — the answer
   *  reads complete without it, so the JSON-LD stays a faithful copy. */
  link?: { href: string; label: string };
}

export interface FaqSection {
  heading: string;
  entries: FaqEntry[];
}

function plan(id: PlanId) {
  const found = PLAN_CATALOG.find((candidate) => candidate.id === id);
  /* istanbul ignore next -- PlanId is exhaustive over PLAN_CATALOG */
  if (!found) throw new Error(`Unknown plan: ${id}`);
  return found;
}

const free = plan("free");
const pro = plan("pro");
const centre = plan("centre");

/** "£2.50" / "91p" — the way a price is written in prose, not on an invoice. */
function money(minor: number): string {
  return minor < 100 ? `${minor}p` : `£${(minor / 100).toFixed(2)}`;
}

/** A plan's contact cap in prose. `null` means uncapped, not zero. */
function contacts(cap: number | null): string {
  return cap === null ? "an unlimited number" : cap.toLocaleString("en-GB");
}

export const FAQ_SECTIONS: readonly FaqSection[] = [
  {
    heading: "Getting started",
    entries: [
      {
        question: "Do I need an account to send a card?",
        answer: [
          "No. You can send a one-off card as a guest — pick a design, add the recipient's name and address, and pay. There's no sign-up and no subscription.",
          "An account is worth having if you send more than the occasional card: it gives you a contact book, a birthday calendar and reminders before each date comes round.",
        ],
        link: { href: "/cards", label: "Browse the card library" },
      },
      {
        question: "What does a card cost?",
        answer: [
          `${money(CARD_PRICE_MINOR)} per card, VAT included, plus one Royal Mail stamp per card — ${money(POSTAGE_MINOR.second_class)} second class or ${money(POSTAGE_MINOR.first_class)} first class. Postage is VAT-exempt, so it's shown as a separate line rather than folded into the card price.`,
          "There's no minimum order, and browsing and designing are free. Paid plans discount the card price.",
        ],
      },
      {
        question: "Is there a free plan?",
        answer: [
          `Yes. Free includes up to ${free.recipientCap} contacts, the full card designer and template library, a birthday calendar with email reminders, and approval of every card before it goes out.`,
          "You only pay when you actually send a card.",
        ],
      },
    ],
  },
  {
    heading: "The cards themselves",
    entries: [
      {
        question: "Are these real cards, or emails?",
        answer: [
          `Real cards. We print each one and post it — ${CARD_SIZE_LABEL}, personalised with the recipient's name.`,
        ],
      },
      {
        question: "Can I use my own artwork?",
        answer: [
          `Yes, on ${pro.name} and above — upload your own design and send it exactly like one of ours.`,
          "On any plan you can personalise the cards in our library with your own message.",
        ],
      },
      {
        question: "Can I add a video or a longer message?",
        answer: [
          "Yes. Each card can carry a scan-to-watch message page — a video, a written note and a link — reached by scanning the card. It's a web page, so nothing needs installing to view it.",
        ],
      },
    ],
  },
  {
    heading: "Sending",
    entries: [
      {
        question: "When do you post the cards?",
        answer: [
          `Every card is posted at least ${DEFAULT_POSTAGE_LEAD_DAYS} working days before the date it's for, whichever postage class you choose. We count back in working days and skip weekends and UK bank holidays, so a bank-holiday week doesn't eat into the time in the post.`,
        ],
      },
      {
        question: "Can birthdays send themselves?",
        answer: [
          `On ${pro.name} and above, yes — approved birthdays send automatically without you doing anything on the day.`,
          `On ${free.name}, birthdays still appear on your calendar and you're reminded, but you approve each card before it's sent. They show up for approval well ahead of the date, so there's time to change the design or the message.`,
        ],
      },
      {
        question: "How many cards can I send at once?",
        answer: [
          `A single bulk send covers up to ${free.batchOrderMaxSize} cards on ${free.name}, ${pro.batchOrderMaxSize} on ${pro.name} and ${centre.batchOrderMaxSize} on ${centre.name}.`,
          "Everyone's name is merged into their own card — you write the message once.",
        ],
      },
    ],
  },
  {
    heading: "Plans, contacts and team",
    entries: [
      {
        question: "How many contacts can I store?",
        answer: [
          `Up to ${contacts(free.recipientCap)} on ${free.name}, ${contacts(pro.recipientCap)} on ${pro.name} and ${contacts(centre.recipientCap)} on ${centre.name}. Beyond that, Enterprise is arranged with us directly.`,
        ],
        link: { href: "/enterprise", label: "About Enterprise" },
      },
      {
        question: "Can colleagues have their own logins?",
        answer: [
          `${centre.name} includes ${centre.includedSeats} team seats, with further seats charged monthly. Each person gets their own login rather than sharing one.`,
        ],
      },
      {
        question: "How do I cancel?",
        answer: [
          "From the billing page in your account, which opens Stripe's customer portal — the same place you download invoices and update your payment card.",
          "Cancelling stops the subscription renewing. A period you've already paid for isn't normally refunded, and your cards and contacts stay yours either way.",
        ],
        link: { href: "/terms", label: "Cancellation terms in full" },
      },
    ],
  },
  {
    heading: "If something goes wrong",
    entries: [
      {
        question: "What happens if a card is returned undelivered?",
        answer: [
          "We reprint and repost it free — card and postage both — once per returned card. That's the Kudos Promise.",
          "You'll get an email asking you to correct the address, and that contact's automatic sends pause until it's sorted, so the same wrong address isn't used again.",
        ],
      },
      {
        question: "What do you do with my contacts' details?",
        answer: [
          "We use them to print and post the cards you ask us to send. We don't add the people in your contact book to our own mailing lists — the only people who hear from us are account holders.",
          "Names, addresses and dates of birth are personal data, so the full detail — what we hold, how long for, and how to have it deleted — is in our privacy policy.",
        ],
        link: { href: "/privacy", label: "Read the privacy policy" },
      },
    ],
  },
];

/** Flat list, in page order — for the structured data and for counting. */
export const FAQ_ENTRIES: readonly FaqEntry[] = FAQ_SECTIONS.flatMap((section) => section.entries);
