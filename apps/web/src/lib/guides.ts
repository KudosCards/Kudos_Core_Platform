import { CARD_SIZE_LABEL, DEFAULT_POSTAGE_LEAD_DAYS, getCardCategory } from "@kudos/shared-types";

/**
 * The occasion guides — "what to write in a ... card".
 *
 * The last piece of SEO Phase 5, and the one with the most obvious trap. The
 * generic version of this page ("what to write in a birthday card") is written
 * by every card retailer on the internet and pulls consumer traffic that has no
 * use for a platform that posts cards for a tuition centre.
 *
 * So these guides answer the question **this** product's visitors actually have:
 * what do you write to a customer, a student, a donor, a club member — where
 * getting the tone wrong is a business problem, not a family one. Every example
 * is written for that setting.
 *
 * Authored as a typed module per ADR 0164. The examples are data, not prose:
 * grouped by who you're writing to, so the page can render them as a list and
 * the Article markup can be generated from the same source.
 *
 * No invented statistics, and no claims about what wording "performs" — nobody
 * here has measured that, and a guide that says so is making it up.
 */

export interface WordingGroup {
  /** Who the card is going to — the thing that actually changes the wording. */
  audience: string;
  /** Why this reader is different, in one line. */
  note: string;
  examples: string[];
}

export interface GuideTip {
  heading: string;
  detail: string;
}

export interface Guide {
  slug: string;
  /** <h1>, and close to what someone would type into a search box. */
  heading: string;
  title: string;
  description: string;
  intro: string[];
  groups: WordingGroup[];
  tips: GuideTip[];
  /** The card category this guide sends readers to. Must exist in CARD_CATEGORIES. */
  categorySlug: string;
  /** Bump when the wording changes — it's the `dateModified` in the markup. */
  updated: string;
}

/**
 * Written for the initial publication of the guides. Article markup needs a
 * date; a made-up older one to look established would be a lie in a machine-
 * readable field, which is the worst place to put one.
 */
const PUBLISHED = "2026-08-18";

const SHARED_TIPS = {
  useTheirName: {
    heading: "Use their name, not their title",
    detail:
      'A card addressed to "our valued customer" reads like a mailshot, because it is one. Put {firstName} in the message and every card in the send comes out with the right name on it.',
  },
  beSpecific: {
    heading: "Name the specific thing",
    detail:
      "One concrete detail — the exam, the season, the years they've been with you — is worth more than three sentences of warm generality. It proves a person wrote it.",
  },
  keepItShort: {
    heading: "Keep it shorter than you think",
    detail: `There's less room than a screen suggests: these are printed ${CARD_SIZE_LABEL}. Two or three lines fills the space and reads better than a paragraph squeezed in.`,
  },
  signAsAPerson: {
    heading: "Sign it as a person",
    detail:
      '"From everyone at the centre" is nobody. A name at the bottom — the tutor, the coach, the manager — is what makes it a card rather than a communication.',
  },
  postItEarly: {
    heading: "Send it before the day, not on it",
    detail: `Every card goes out at least ${DEFAULT_POSTAGE_LEAD_DAYS} working days ahead, so it arrives in time rather than the week after. Set the date and it looks after itself.`,
  },
} satisfies Record<string, GuideTip>;

export const GUIDES: readonly Guide[] = [
  {
    slug: "what-to-write-in-a-birthday-card",
    heading: "What to write in a birthday card",
    title: "What to write in a birthday card",
    description:
      "Wording for birthday cards to customers, students, club members and staff — with examples you can send as they are.",
    intro: [
      "A birthday card from an organisation is a harder thing to write than a birthday card from a friend. Too casual and it's odd; too formal and it reads like a renewal notice.",
      "What follows is grouped by who's receiving it, because that's the thing that actually changes the wording. Take any of them as they are, or use them as a starting point.",
    ],
    groups: [
      {
        audience: "To a customer or client",
        note: "Warm, brief, and with nothing to buy in it. The moment a birthday card asks for something it stops being a birthday card.",
        examples: [
          "Happy birthday, {firstName}. Hope you get a proper day off out of it.",
          "Happy birthday from all of us, {firstName} — good to have you with us this year.",
          "Many happy returns, {firstName}. Have a great one.",
        ],
      },
      {
        audience: "To a student",
        note: "Written to them, not to their parents — a card that a fourteen-year-old is happy to leave on the side.",
        examples: [
          "Happy birthday, {firstName}! Have a brilliant day — and no homework from us today.",
          "Happy birthday, {firstName}. Everyone here hopes it's a good one.",
          "Happy birthday, {firstName} — enjoy it. See you next week.",
        ],
      },
      {
        audience: "To a club member",
        note: "The club voice, not a corporate one. It should sound like it came from the people they see on a Saturday.",
        examples: [
          "Happy birthday, {firstName}! From everyone at the club — see you at training.",
          "Have a great birthday, {firstName}. Rest up, big season ahead.",
          "Happy birthday, {firstName} — hope it's a good one on and off the pitch.",
        ],
      },
      {
        audience: "To a colleague or member of staff",
        note: "Specific beats effusive. A line that shows you know what they actually do lands better than a superlative.",
        examples: [
          "Happy birthday, {firstName}. Take the afternoon, you've earned it.",
          "Happy birthday, {firstName} — thanks for everything you've done this year.",
          "Have a great birthday, {firstName}. The place runs better because you're in it.",
        ],
      },
    ],
    tips: [
      SHARED_TIPS.useTheirName,
      SHARED_TIPS.keepItShort,
      SHARED_TIPS.signAsAPerson,
      SHARED_TIPS.postItEarly,
    ],
    categorySlug: "birthday",
    updated: PUBLISHED,
  },
  {
    slug: "what-to-write-in-a-thank-you-card",
    heading: "What to write in a thank you card",
    title: "What to write in a thank you card",
    description:
      "Thank-you wording for customers, donors, volunteers and families — specific enough to be believed, short enough to fit on a card.",
    intro: [
      'Most thank-yous fail in the same way: they thank someone for a category rather than for a thing. "Thank you for your support" could be sent to anyone, and the reader knows it.',
      "The examples below all name something. That's the whole difference between a thank-you that gets kept and one that gets recycled.",
    ],
    groups: [
      {
        audience: "To a customer, after a purchase",
        note: "Sent once, properly — not as the first message in a follow-up sequence.",
        examples: [
          "Thank you for your order, {firstName}. It was a pleasure putting it together for you.",
          "Thanks for choosing us, {firstName}. Any questions at all, you know where we are.",
          "Thank you, {firstName} — we know you had other options, and we're glad you picked us.",
        ],
      },
      {
        audience: "To a donor",
        note: "Say what the money does, in plain numbers if you have them and in plain language if you don't. Never inflate it.",
        examples: [
          "Thank you, {firstName}. Your donation goes straight into the work — we'll make it count.",
          "Thank you for giving again this year, {firstName}. Regular supporters are what let us plan ahead.",
          "Thank you, {firstName}. It's a real difference, and we don't take it for granted.",
        ],
      },
      {
        audience: "To a volunteer",
        note: "Volunteers are thanked in the abstract constantly. Name the hours, the shift, the specific job.",
        examples: [
          "Thank you for everything you've given us this year, {firstName} — the hours as much as the help.",
          "Thank you, {firstName}. You've been part of this for a while now, and it shows.",
          "Thanks for stepping in when we needed it, {firstName}. It didn't go unnoticed.",
        ],
      },
      {
        audience: "To a parent or family",
        note: "Thank them for the thing they actually did — the lifts, the turning up, the sticking with it.",
        examples: [
          "Thank you for your support this year, {firstName} — the progress we've seen has been a joint effort.",
          "Thank you, {firstName}. Getting them here every week is half the work, and we know it.",
          "Thank you for trusting us with them, {firstName}. It's been a pleasure.",
        ],
      },
    ],
    tips: [
      SHARED_TIPS.beSpecific,
      SHARED_TIPS.useTheirName,
      SHARED_TIPS.keepItShort,
      {
        heading: "Don't attach an ask",
        detail:
          "A thank-you with a renewal reminder underneath it isn't a thank-you. If there's something to ask for, ask another day — the card is doing a different job.",
      },
    ],
    categorySlug: "thank-you",
    updated: PUBLISHED,
  },
  {
    slug: "what-to-write-in-a-congratulations-card",
    heading: "What to write in a congratulations card",
    title: "What to write in a congratulations card",
    description:
      "Congratulations wording for exam results, promotions, new jobs and milestones — including what to write when the result wasn't what they hoped for.",
    intro: [
      "Congratulations cards go wrong in two directions. They either overclaim — treating a modest result as a triumph, which the recipient can feel — or they hedge so carefully that they read as disappointment.",
      "The examples below aim at the thing that happened. There's also a group for results that didn't go the way anyone wanted, because those cards are the ones that actually get remembered.",
    ],
    groups: [
      {
        audience: "For exam results",
        note: 'Credit the work, not the luck. "You earned that" says more than "well done".',
        examples: [
          "Congratulations, {firstName} — that's a brilliant set of results, and you worked for every one of them.",
          "Well done, {firstName}. You put the hours in and it shows.",
          "Congratulations, {firstName}! Everyone here is delighted for you.",
        ],
      },
      {
        audience: "When the results weren't what they hoped",
        note: "Send something. A card that acknowledges a hard day is worth more than a card that celebrates an easy one.",
        examples: [
          "Not the day you wanted, {firstName} — but it's one set of results, not a verdict. We're still here.",
          "{firstName}, you worked hard for these and that hasn't changed. Let's talk about what's next.",
          "Chin up, {firstName}. Plenty of routes from here, and we'll help you find yours.",
        ],
      },
      {
        audience: "For a promotion or a new job",
        note: "Say what they'll be good at. Generic congratulations are forgettable; a specific one is a reference.",
        examples: [
          "Congratulations on the new role, {firstName} — they've made a good decision.",
          "Well deserved, {firstName}. Congratulations, and good luck with it.",
          "Congratulations, {firstName}! Enjoy the new job — they're lucky to have you.",
        ],
      },
      {
        audience: "For a business or personal milestone",
        note: "Anniversaries, first years, retirements. Name the number — it's the whole point of the card.",
        examples: [
          "Congratulations on ten years, {firstName}. That's no small thing.",
          "Congratulations, {firstName} — a year in and going strong. Here's to the next one.",
          "Congratulations, {firstName}. Thoroughly deserved, and long overdue.",
        ],
      },
    ],
    tips: [
      SHARED_TIPS.beSpecific,
      SHARED_TIPS.signAsAPerson,
      SHARED_TIPS.postItEarly,
      {
        heading: "Match the size of the achievement",
        detail:
          "Overpraising a small win reads as insincere and makes the next card mean less. Say the true thing warmly rather than a bigger thing loudly.",
      },
    ],
    categorySlug: "congratulations",
    updated: PUBLISHED,
  },
  {
    slug: "what-to-write-in-an-achievement-card",
    heading: "What to write in an achievement card",
    title: "What to write in an achievement card",
    description:
      "Wording for recognising progress, effort and improvement — for tuition centres, schools and clubs, where the achievement isn't always a result.",
    intro: [
      "The most useful achievement cards aren't for the top of the class. They're for the student who moved a grade, the player who turned up all season, the one who finally asked for help.",
      "That's harder to write than a congratulations card, because you're naming effort rather than an outcome. These examples do that without being patronising, which is the line to walk.",
    ],
    groups: [
      {
        audience: "For progress",
        note: "Compare them to themselves, never to the class. The improvement is the achievement.",
        examples: [
          "{firstName}, you've moved a long way this term — and you did it yourself. Well done.",
          "Really pleased with your progress, {firstName}. Keep going exactly as you are.",
          "Well done, {firstName}. Where you are now isn't where you started, and that's the bit that counts.",
        ],
      },
      {
        audience: "For effort",
        note: "The card for a student who worked hard and didn't get the mark. Worth sending precisely because nobody else will.",
        examples: [
          "{firstName}, nobody worked harder this term. That habit will pay off — it always does.",
          "Well done for sticking with it, {firstName}. The hard part is turning up when it isn't going well.",
          "{firstName}, you've not missed a session all term. That's an achievement in itself.",
        ],
      },
      {
        audience: "For a sporting achievement",
        note: "Name the match, the time, the position. Specifics are what get pinned to a fridge.",
        examples: [
          "Great season, {firstName} — you've been one of the first names down all year.",
          "Well played, {firstName}. That performance on Saturday won't be forgotten in a hurry.",
          "Congratulations, {firstName} — a personal best is a personal best. Well done.",
        ],
      },
      {
        audience: "For a first, or a breakthrough",
        note: "First time on stage, first competition, first time asking a question in class. Small in the abstract, big to them.",
        examples: [
          "First one's the hardest, {firstName} — and you did it. Well done.",
          "{firstName}, that took some nerve. Really well done.",
          "Proud of you for having a go, {firstName}. That's the difficult bit done.",
        ],
      },
    ],
    tips: [
      {
        heading: "Recognise the effort, not the ranking",
        detail:
          'A card that says "top of the class" only ever goes to one person. A card that says what this student did can go to all of them, and means more to each.',
      },
      SHARED_TIPS.beSpecific,
      SHARED_TIPS.signAsAPerson,
      SHARED_TIPS.keepItShort,
    ],
    categorySlug: "achievement",
    updated: PUBLISHED,
  },
];

/** The guide written for a card category, if there is one. Lets a category page
 *  link at its guide without keeping a second mapping. */
export function guideForCategory(categorySlug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.categorySlug === categorySlug);
}

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}

/** The category a guide points at — resolved, not assumed, so a renamed
 *  category can't leave a guide linking at a 404. */
export function guideCategory(guide: Guide) {
  const category = getCardCategory(guide.categorySlug);
  /* istanbul ignore next -- categorySlug is checked against CARD_CATEGORIES */
  if (!category) throw new Error(`Guide ${guide.slug} names unknown category`);
  return category;
}
