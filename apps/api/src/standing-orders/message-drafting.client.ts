import { Logger } from "@nestjs/common";
import { z } from "zod";
import {
  MESSAGE_DRAFT_COUNT,
  STANDING_ORDER_MESSAGE_MAX_LENGTH,
  type StandingOrderMessageSource,
} from "@kudos/shared-types";
import { httpRequest } from "../common/http-request";

/**
 * Drafting birthday messages with a model.
 *
 * A plain call to the Messages API rather than the SDK, so it inherits this
 * codebase's deadline and retry rules (`httpRequest`) instead of bringing a
 * second set — and so the request body is something a reader can see in one
 * place, which matters more here than anywhere else in the app.
 *
 * **What is sent.** Two things, both named below: the subscriber's own business
 * name, and a short brief they typed. Nothing about a contact ever reaches
 * this file — not a name, not a birthday, not a count. That is not a promise
 * kept by care, it is a property of the shape: `draftBirthdayMessages` takes
 * two strings, and a drafted message is a template with `{firstName}` in it
 * that the print run fills in weeks later (ADR 0031).
 *
 * See docs/adr/0263.
 */

/** Pinned to an exact id, not a moving alias: this writes words that get
 *  printed on paper, and "whatever is current" is not a thing to discover from
 *  a customer's card. Overridable by env so a change is a variable, not a
 *  release. */
export const DEFAULT_DRAFTING_MODEL = "claude-haiku-4-5-20251001";

/** The wire version the Messages API expects. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Six short messages need nowhere near this; it is a ceiling on a bill, not a
 *  target. */
const MAX_TOKENS = 1024;

/** One attempt gets 20 seconds, and a 429 or a 5xx is worth one more go —
 *  somebody is watching a spinner, so this cannot be generous. */
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;

/**
 * What the model is for, and what it must not do.
 *
 * The three prohibitions are the interesting part. No names, because the whole
 * design of this feature is that the model never learns any. No dates or ages,
 * because a pool message is reused for years and for everybody. No promises,
 * because a card that offers a discount the business did not agree to is worse
 * than a dull card.
 */
const SYSTEM_PROMPT = [
  "You write short messages for the inside of birthday cards, which a British business posts to its customers, members, students or staff.",
  "",
  "Rules:",
  "- One or two sentences. These are printed inside a card, not an email.",
  "- British English. Warm and natural; never gushing, never corporate.",
  "- Use the placeholder {firstName} where the person's name should go. Write it exactly like that, in curly braces.",
  "- Never invent a name, an age, a date, a year, or anything about the person. You do not know who will receive these.",
  "- Never promise a discount, a gift, an offer or anything the business has not said it is giving.",
  "- No emoji, no hashtags, no sign-off, no quotation marks around the message.",
  "- Each message must be genuinely different from the others in wording and in tone.",
  "",
  `Reply with a JSON array of exactly ${MESSAGE_DRAFT_COUNT} strings and nothing else. No prose before or after it, no code fence.`,
].join("\n");

/** The model's reply, as far as we rely on it. Anything else about the
 *  response shape is none of our business. */
const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export interface DraftRequest {
  /** The subscriber's own business name, or null when we will not send one —
   *  see `MessageDraftingService`, which withholds it for personal accounts. */
  businessName: string | null;
  /** What they typed in the box, or null. */
  brief: string | null;
}

/** What the service depends on, so an e2e can stand in for it. */
export interface MessageDrafter {
  draftBirthdayMessages(request: DraftRequest): Promise<string[]>;
}

export class MessageDraftingError extends Error {
  constructor(
    readonly reason: "refused" | "unusable" | "upstream",
    message: string,
  ) {
    super(message);
    this.name = "MessageDraftingError";
  }
}

export class AnthropicMessageDrafter implements MessageDrafter {
  private readonly logger = new Logger(AnthropicMessageDrafter.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_DRAFTING_MODEL,
    private readonly baseUrl: string = "https://api.anthropic.com",
  ) {}

  /**
   * The whole prompt, assembled from the two fields above and nothing else.
   *
   * Exported shape rather than an inline string so a test can read it: the
   * claim "no contact data is sent" is only worth making if something checks
   * the body that actually goes.
   */
  buildBody(request: DraftRequest): Record<string, unknown> {
    const about = [
      request.businessName ? `The business is called ${request.businessName}.` : null,
      request.brief ? `They asked for: ${request.brief}` : null,
    ].filter((line): line is string => line !== null);

    return {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [`Write ${MESSAGE_DRAFT_COUNT} birthday card messages.`, ...about].join("\n"),
        },
      ],
    };
  }

  async draftBirthdayMessages(request: DraftRequest): Promise<string[]> {
    const response = await httpRequest(
      `${this.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(this.buildBody(request)),
      },
      { timeoutMs: TIMEOUT_MS, maxAttempts: MAX_ATTEMPTS, label: "Anthropic messages" },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new MessageDraftingError(
        "upstream",
        `Anthropic returned ${response.status}: ${detail.slice(0, 500)}`,
      );
    }

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new MessageDraftingError("unusable", "Anthropic returned an unfamiliar response shape");
    }

    const text = parsed.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    return usableDrafts(text);
  }
}

/**
 * The model's text, turned into messages we are willing to show.
 *
 * Everything here treats the reply as untrusted input, because that is what it
 * is. It is asked for a bare JSON array and told not to wrap it, and it is
 * still read with a tolerance for a code fence or a sentence of preamble —
 * asking politely is not a parser.
 *
 * A draft that is empty, too long for a card, or a repeat of another is
 * dropped rather than shown. Showing it and letting the save refuse it later
 * would put the model's mistake in the subscriber's lap.
 */
export function usableDrafts(text: string): string[] {
  const array = firstJsonArray(text);
  if (array === null) {
    throw new MessageDraftingError("unusable", "Anthropic did not return a list of messages");
  }

  const seen = new Set<string>();
  const drafts: string[] = [];
  for (const entry of array) {
    if (typeof entry !== "string") continue;
    const draft = entry.trim();
    if (draft.length === 0 || draft.length > STANDING_ORDER_MESSAGE_MAX_LENGTH) continue;
    const key = draft.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push(draft);
    if (drafts.length === MESSAGE_DRAFT_COUNT) break;
  }

  if (drafts.length === 0) {
    throw new MessageDraftingError(
      "unusable",
      "Nothing Anthropic returned was usable as a message",
    );
  }
  return drafts;
}

/** The first `[...]` in the text, parsed. Tolerates a code fence and any prose
 *  around it; refuses to guess at anything that is not valid JSON. */
function firstJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Every message a draft becomes is recorded as this, which is not the same
 *  promise as the subscriber's own words. */
export const DRAFTED_MESSAGE_SOURCE: StandingOrderMessageSource = "assisted";
