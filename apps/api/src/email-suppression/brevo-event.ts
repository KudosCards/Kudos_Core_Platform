import type { EmailSuppressionReason } from "@prisma/client";

/**
 * Brevo's transactional-webhook vocabulary, translated into ours.
 *
 * Brevo spells the same event two ways depending on where you meet it: the API
 * that *subscribes* to events takes camelCase (`hardBounce`), while the payload
 * it later *delivers* carries snake_case (`"event": "hard_bounce"`). Nothing in
 * the documentation promises that split is stable, and getting it wrong is
 * silent — an unrecognised event is a suppression we never record, which is the
 * exact failure this whole feature exists to end.
 *
 * So rather than encoding one spelling and hoping, every incoming event is
 * reduced to letters only before it is matched. `hard_bounce`, `hardBounce`,
 * `HARD-BOUNCE` and `Hard Bounce` all become `hardbounce`, and a future change
 * of separator or case costs us nothing.
 */
export function normaliseBrevoEvent(event: string): string {
  return event.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Events meaning Brevo will not deliver to this address. Keys are already
 * normalised; both of Brevo's spellings for a given event reduce to one key,
 * and the synonyms are listed because Brevo uses them interchangeably across
 * payloads and dashboard copy.
 */
const SUPPRESSING: Readonly<Record<string, EmailSuppressionReason | undefined>> = {
  hardbounce: "hard_bounce",
  blocked: "blocked",
  invalid: "invalid",
  invalidemail: "invalid",
  spam: "spam",
  complaint: "spam",
  unsubscribe: "unsubscribed",
  unsubscribed: "unsubscribed",
};

/**
 * Events proving the address works: Brevo would not deliver to an address it
 * blocks, so a delivery is the authority's own word that a past suppression is
 * over. This is what stops a corrected address reading as undeliverable
 * forever, without anyone having to guess that it was fixed.
 */
const RECOVERING: ReadonlySet<string> = new Set(["delivered"]);

export type BrevoEventMeaning =
  { kind: "suppress"; reason: EmailSuppressionReason } | { kind: "recover" } | { kind: "ignore" };

/**
 * What an event means for deliverability.
 *
 * Deliberately narrow. A soft bounce is a full mailbox or a server having a bad
 * afternoon, not a dead address, and suppressing on one would lose real mail; a
 * deferral is the same thing earlier. Opens and clicks are neither useful here
 * nor something we want to keep. All of them are ignored.
 */
export function meaningOfBrevoEvent(event: string): BrevoEventMeaning {
  const key = normaliseBrevoEvent(event);
  const reason = SUPPRESSING[key];
  if (reason) return { kind: "suppress", reason };
  if (RECOVERING.has(key)) return { kind: "recover" };
  return { kind: "ignore" };
}
