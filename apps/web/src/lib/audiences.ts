import { DEFAULT_POSTAGE_LEAD_DAYS, PLAN_CATALOG, type PlanId } from "@kudos/shared-types";

/**
 * The audience pages — one per "Used by" pill on the homepage.
 *
 * Authored as a typed module per ADR 0164. Two rules carried over from the FAQ,
 * plus one that only matters here:
 *
 * 1. **Nothing invented.** No statistics, no testimonials, no "centres see a 30%
 *    lift". Every capability named below is a feature that exists — a plan
 *    entitlement, an occasion type, an integration — and plan numbers resolve
 *    from `PLAN_CATALOG` rather than being typed twice.
 * 2. **Not doorway pages.** These share a shape, not a script. A doorway page is
 *    the homepage with one noun swapped, and search engines are explicitly
 *    looking for exactly that. What differs here is substantive: a sports club
 *    sends on renewals, a school sends at scale and needs shared logins, a
 *    charity's moment is the thank-you after a donation. If two audiences would
 *    genuinely say the same thing, they don't both need a page.
 * 3. **Only claim what the audience would recognise.** No safeguarding or
 *    compliance promises — the pages say what the product does (a person
 *    approves every card; here's the privacy policy) and stop there.
 */

export interface AudienceMoment {
  /** The occasion, in the audience's own words. */
  name: string;
  detail: string;
}

export interface AudienceFit {
  heading: string;
  detail: string;
}

export interface Audience {
  slug: string;
  /** The homepage pill this page sits behind — must match `usedBy` on page.tsx. */
  pill: string;
  /** Short name for breadcrumbs and nav. */
  name: string;
  /** <h1>. Written as a phrase someone would search, not a slogan. */
  heading: string;
  title: string;
  description: string;
  intro: string[];
  moments: AudienceMoment[];
  fit: AudienceFit[];
  /** The plan this audience usually lands on, and why in their terms. */
  planId: PlanId;
  planReason: string;
}

function planFor(id: PlanId) {
  const found = PLAN_CATALOG.find((plan) => plan.id === id);
  /* istanbul ignore next -- PlanId is exhaustive over PLAN_CATALOG */
  if (!found) throw new Error(`Unknown plan: ${id}`);
  return found;
}

const FREE = planFor("free");
const PRO = planFor("pro");
const CENTRE = planFor("centre");

/** 2000 → "2,000". Plan caps are quoted in prose, so they read as prose. */
function count(value: number): string {
  return value.toLocaleString("en-GB");
}

/**
 * In the order the homepage's "Used by" pills render them — this array is the
 * display order on the homepage, the hub and the sideways links alike, so there
 * is no second list to keep in step with it.
 */
export const AUDIENCES: readonly Audience[] = [
  {
    slug: "businesses",
    pill: "Businesses",
    name: "Businesses",
    heading: "Client and staff cards for businesses",
    title: "Cards for businesses",
    description:
      "Client birthdays, work anniversaries and renewal dates — synced from your CRM, printed and posted as real cards.",
    intro: [
      "A card on a client's desk does something a marketing email can't: it's from a person, it took effort, and it stays on the desk.",
      "If your contacts already live in HubSpot or GoHighLevel, they don't need re-keying — connect the account and the dates come with them.",
    ],
    moments: [
      {
        name: "Client birthdays",
        detail: "The date your CRM already holds, turned into a card that arrives on the day.",
      },
      {
        name: "Work anniversaries",
        detail: "For staff, and for the anniversary of a client signing.",
      },
      {
        name: "Renewals",
        detail:
          "Renewal dates recur annually and can be grouped, so everyone renewing this month can be sent to together.",
      },
      {
        name: "Thank you, after the sale",
        detail: "Sent once, properly, instead of a follow-up sequence.",
      },
    ],
    fit: [
      {
        heading: "Connect the CRM you already use",
        detail:
          "HubSpot and GoHighLevel connect directly, so contacts and their dates sync across rather than being exported and re-imported.",
      },
      {
        heading: "Your own artwork",
        detail: `Upload your own card design from ${PRO.name} upwards and send it exactly like one of ours — branded, and still personalised per recipient.`,
      },
      {
        heading: "Priced per card, not per send",
        detail:
          "Cards are charged individually with postage shown as its own line, and paid plans discount the card price.",
      },
    ],
    planId: "pro",
    planReason: `${PRO.name} is where the CRM-fed birthdays run on their own and your own branding goes on the card; ${CENTRE.name} if more than one person sends.`,
  },
  {
    slug: "tuition-centres",
    pill: "Tuition Centres",
    name: "Tuition centres",
    heading: "Birthday and achievement cards for tuition centres",
    title: "Cards for tuition centres",
    description:
      "Send every student a real birthday card, and a card when they pass. Import your list once, approve each card, and we print and post them.",
    intro: [
      "A tuition centre lives on families staying, and on the families they tell. A card that arrives on a student's birthday — printed, addressed to them, on the doormat — is remembered in a way a reminder email isn't.",
      "You import your student list once. After that the birthdays look after themselves, and you decide what goes out.",
    ],
    moments: [
      {
        name: "Student birthdays",
        detail:
          "The date you already hold. Once it's on a student's record their birthday appears on the calendar every year without being re-entered.",
      },
      {
        name: "Exam results and passes",
        detail:
          "A card that says well done, sent the week the results land, rather than a message in a group chat.",
      },
      {
        name: "Welcome, when they join",
        detail: "The first thing a new family receives from you is a real card, not an invoice.",
      },
      {
        name: "End of term",
        detail:
          "One message, merged into a card for every student — you write it once and send the whole list together.",
      },
    ],
    fit: [
      {
        heading: "Bring your list in as it is",
        detail:
          "Import your students from a CSV — the spreadsheet you already keep. Names, addresses and dates of birth come across in one go.",
      },
      {
        heading: "Nothing goes out without you",
        detail:
          "Every card waits for approval before it's printed. You see what's queued, and you can change the design or the message up to the point it's sent.",
      },
      {
        heading: "Add a video the parents can watch",
        detail:
          "Each card can carry a scan-to-watch page — a short message from their tutor, a note and a link — reached by scanning the card itself.",
      },
    ],
    planId: "pro",
    planReason:
      "Most centres land here: it covers a full class list, sends birthdays without anyone remembering to, and lets you put your own artwork on the cards.",
  },
  {
    slug: "schools",
    pill: "Schools",
    name: "Schools",
    heading: "Pupil birthday and achievement cards for schools",
    title: "Cards for schools",
    description:
      "Hundreds of pupils, one contact list, and a card that arrives on the right day. Shared logins for the office team, and a person approves every card.",
    intro: [
      "The problem in a school isn't wanting to send cards — it's the volume. A year group is hundreds of dates, spread across the calendar, and every one of them falls on a day when somebody is already busy.",
      "Kudos Cards holds the whole list, puts the dates on one calendar, and prints and posts the cards. What's left for the school is deciding what goes out.",
    ],
    moments: [
      {
        name: "Pupil birthdays",
        detail:
          "Every pupil, every year, from one list — including the ones that fall in the holidays, which are the ones usually missed.",
      },
      {
        name: "Achievement and merit",
        detail:
          "A posted card home carries further than a certificate in a bag, and the family sees it.",
      },
      {
        name: "Leavers",
        detail: "A whole cohort in one send, each card personalised with the pupil's own name.",
      },
      {
        name: "Staff milestones",
        detail:
          "Work anniversaries and birthdays for the staff room, tracked the same way as everything else.",
      },
    ],
    fit: [
      {
        heading: "Built for the numbers",
        detail: `The ${CENTRE.name} plan holds up to ${count(CENTRE.recipientCap ?? 0)} contacts and sends up to ${count(CENTRE.batchOrderMaxSize)} cards in a single go, which covers a form, a year group or the whole school.`,
      },
      {
        heading: "The office team share one account",
        detail: `${CENTRE.includedSeats} logins are included, so cards aren't stuck behind one person's password when they're on leave.`,
      },
      {
        heading: "A person approves every card",
        detail:
          "Nothing prints automatically unless you switch that on. Pupil names, addresses and dates of birth are personal data — what we hold and how long for is set out in full in our privacy policy.",
      },
    ],
    planId: "centre",
    planReason:
      "The contact limit and the size of a single send are what decide it for a school, and shared logins mean the job isn't one person's.",
  },
  {
    slug: "sports-clubs",
    pill: "Sports Clubs",
    name: "Sports clubs",
    heading: "Birthday and membership cards for sports clubs",
    title: "Cards for sports clubs",
    description:
      "Members' birthdays, renewal dates and end-of-season cards — tracked in one place and posted for you.",
    intro: [
      "Clubs lose members quietly. Someone's subscription lapses, nobody notices, and they don't come back next season.",
      "Kudos Cards tracks renewal dates as their own recurring stream, alongside birthdays — so the club can send something before the renewal, not a chasing email after it.",
    ],
    moments: [
      {
        name: "Membership renewals",
        detail:
          "A renewal date sits on a member's record and comes round every year, so you can pull up everyone renewing this month and send to all of them at once.",
      },
      {
        name: "Members' birthdays",
        detail: "Junior sections especially — a card from the club lands differently at that age.",
      },
      {
        name: "Player of the match, and awards",
        detail: "Sent the same week, to the address rather than to a parent's WhatsApp.",
      },
      {
        name: "Welcome and end of season",
        detail: "The whole squad in one send, each card with the player's own name on it.",
      },
    ],
    fit: [
      {
        heading: "Renewals as real dates, not a spreadsheet tab",
        detail:
          'Renewals and anniversaries are tracked like birthdays: on the calendar, recurring every year, and groupable — "renewals due this month" is a list you can send to.',
      },
      {
        heading: "The whole squad in one send",
        detail: `Write the message once; everyone's name is merged into their own card. Up to ${count(PRO.batchOrderMaxSize)} cards in a single send on ${PRO.name}, ${count(CENTRE.batchOrderMaxSize)} on ${CENTRE.name}.`,
      },
      {
        heading: "A video from the coach",
        detail:
          "Add a scan-to-watch page to the card — a clip, a note and a link, which is often the bit that gets shown around.",
      },
    ],
    planId: "pro",
    planReason: `${PRO.name} covers a club-sized list with birthdays running on their own, and puts the club's own artwork on the cards.`,
  },
  {
    slug: "charities",
    pill: "Charities",
    name: "Charities",
    heading: "Thank-you and supporter cards for charities",
    title: "Cards for charities",
    description:
      "Thank donors with something that isn't another email. Volunteer anniversaries, supporter birthdays and post-campaign thank-yous, posted for you.",
    intro: [
      "Donors and volunteers are thanked by email, which is where every other charity thanks them too. A card that arrives in the post is opened, and it tends to stay on a shelf rather than in an archive folder.",
      "Kudos Cards keeps your supporters and the dates that matter to them in one place, then prints and posts the cards for you.",
    ],
    moments: [
      {
        name: "Thank you, after a donation",
        detail: "Sent as a card rather than a receipt with a sentence at the bottom.",
      },
      {
        name: "Volunteer anniversaries",
        detail:
          "One year, five years — an anniversary date sits on the volunteer's record and comes round on its own.",
      },
      {
        name: "Supporter birthdays",
        detail: "For the regular givers who've been with you for years.",
      },
      {
        name: "After a campaign",
        detail:
          'Everyone who gave, thanked in a single send — addressed individually, not "Dear Supporter".',
      },
    ],
    fit: [
      {
        heading: "Show where it went",
        detail:
          "A scan-to-watch page on the card can carry a short film of the work the money paid for — the thing an email attachment never gets watched for.",
      },
      {
        heading: "Anniversaries that keep themselves",
        detail:
          "Set the date a volunteer started and it recurs every year, on the same calendar as everything else.",
      },
      {
        heading: "Costs you can predict",
        detail:
          "Cards are charged per card with the postage shown separately, so a thank-you run can be costed before it's sent.",
      },
    ],
    planId: "pro",
    planReason:
      "Enough supporters for most local charities, your own branding on the cards, and a large enough single send for a post-campaign thank-you.",
  },
  {
    slug: "care-teams",
    pill: "Care Teams",
    name: "Care teams",
    heading: "Birthday cards for care homes and care teams",
    title: "Cards for care teams",
    description:
      "Nobody's birthday missed on a busy shift. Residents' birthdays and anniversaries tracked in one calendar, with cards printed and posted for you.",
    intro: [
      "A birthday missed in a care setting isn't an administrative slip — it's the day itself, and it doesn't come round again.",
      "The dates go on one calendar that any member of the team can see and add to, and the cards are printed and posted without anyone leaving the building.",
    ],
    moments: [
      {
        name: "Residents' birthdays",
        detail:
          "On the calendar the moment the date is added, and every year after, whoever is on shift.",
      },
      {
        name: "Anniversaries of moving in",
        detail: "Tracked as their own recurring date, separate from the birthday.",
      },
      {
        name: "Thank-yous to families",
        detail: "A card to the family after a visit or at the end of a difficult stretch.",
      },
      {
        name: "Staff recognition",
        detail: "Work anniversaries and birthdays for the team, on the same list.",
      },
    ],
    fit: [
      {
        heading: "It doesn't depend on who's on shift",
        detail:
          "Birthdays can send on their own, so a busy week doesn't mean a missed one. Or keep approval on and check the week's cards in one go.",
      },
      {
        heading: "More than one person can run it",
        detail: `Included logins on the ${CENTRE.name} plan mean the activities coordinator, the manager and the office aren't sharing a password.`,
      },
      {
        heading: "If a card comes back",
        detail:
          "We reprint and repost it free, once per returned card — and the contact is flagged so the same wrong address isn't used again.",
      },
    ],
    planId: "centre",
    planReason:
      "Shared logins are what matters here, plus room for residents, families and staff on one list.",
  },
  {
    slug: "individuals",
    pill: "Individuals",
    name: "Individuals",
    heading: "Never miss a family birthday again",
    title: "Cards for individuals",
    description:
      "Put the birthdays in once and we'll remind you — or send them for you. Real printed cards, posted in the UK, with no subscription needed.",
    intro: [
      "Most missed birthdays aren't forgotten, they're remembered two days late. The card is the bit that doesn't happen in time.",
      "Add the dates once and they stay. You can send a single card as a guest without an account at all, or keep a free one and be reminded before each date.",
    ],
    moments: [
      {
        name: "Family birthdays",
        detail: "Everyone's, in one place, instead of across a phone calendar and a memory.",
      },
      {
        name: "Anniversaries",
        detail: "Added once, then they come round every year without being re-entered.",
      },
      {
        name: "A card, right now",
        detail: "Pick one, add the address, pay — no account, no subscription.",
      },
    ],
    fit: [
      {
        heading: "Free to keep the dates",
        detail: `The ${FREE.name} plan holds up to ${count(FREE.recipientCap ?? 0)} contacts with the calendar and email reminders. You only pay when a card is actually sent.`,
      },
      {
        heading: "It's a real card",
        detail:
          "Printed and posted to their address, personalised with their name — not an e-card and not a gift voucher.",
      },
      {
        heading: "Posted in time",
        detail: `Every card goes out at least ${DEFAULT_POSTAGE_LEAD_DAYS} working days before the date it's for, counting around weekends and bank holidays.`,
      },
    ],
    planId: "free",
    planReason:
      "Free covers a family's worth of dates with reminders before each one; you pay for cards as you send them.",
  },
];

export function getAudience(slug: string): Audience | undefined {
  return AUDIENCES.find((audience) => audience.slug === slug);
}

/** The audience's plan, resolved from the catalog so names and caps stay in step. */
export function audiencePlan(audience: Audience) {
  return planFor(audience.planId);
}
