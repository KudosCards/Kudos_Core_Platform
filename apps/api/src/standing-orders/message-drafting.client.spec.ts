import {
  AnthropicMessageDrafter,
  MessageDraftingError,
  usableDrafts,
} from "./message-drafting.client";
import { MESSAGE_DRAFT_COUNT, STANDING_ORDER_MESSAGE_MAX_LENGTH } from "@kudos/shared-types";

/**
 * The one call this product makes to a model.
 *
 * Two things are pinned here. What goes up — because the safety argument for
 * this feature is that no contact data is in the prompt, and an argument that
 * rests on nobody having added a field is not an argument. And what comes back
 * — because it is untrusted text that ends up printed inside a card.
 */

function fakeResponse(init: { ok: boolean; status?: number; json?: unknown; text?: string }) {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: () => Promise.resolve(init.json ?? {}),
    text: () => Promise.resolve(init.text ?? JSON.stringify(init.json ?? {})),
  } as unknown as Response;
}

function reply(drafts: string[]) {
  return fakeResponse({
    ok: true,
    json: { content: [{ type: "text", text: JSON.stringify(drafts) }] },
  });
}

const SIX = [
  "Happy birthday {firstName} — have a lovely day.",
  "Wishing you a wonderful birthday, {firstName}.",
  "Many happy returns, {firstName}!",
  "Hope your birthday is a good one, {firstName}.",
  "Happy birthday {firstName}, from all of us.",
  "Have a brilliant birthday, {firstName}.",
];

describe("what is sent to the model", () => {
  const drafter = new AnthropicMessageDrafter("sk-test", "claude-test", "https://api.test");

  it("is assembled from the business name and the brief, and nothing else", () => {
    const body = drafter.buildBody({ businessName: "Bright Sparks", brief: "warm, a bit funny" });
    const sent = JSON.stringify(body);

    // Whatever else the prompt says, these two are the only inputs — so the
    // request for an account with a thousand contacts is the same size as one
    // for an account with none.
    expect(sent).toContain("Bright Sparks");
    expect(sent).toContain("warm, a bit funny");
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
    expect(body.messages).toHaveLength(1);
  });

  it("sends nothing at all about the account when there is nothing to send", () => {
    // A personal account's name is a person's name, so the service withholds
    // it. What arrives here as null must not become the string "null".
    const body = drafter.buildBody({ businessName: null, brief: null });
    const content = (body.messages as { content: string }[])[0]!.content;
    expect(content).not.toMatch(/null|undefined/);
    expect(content).toContain(`Write ${MESSAGE_DRAFT_COUNT} birthday card messages.`);
  });

  it("tells the model never to invent anything about the person", () => {
    // The pool is reused for years and for everybody in it. A message that
    // names an age or a year is wrong for all but one of them.
    const system = String(drafter.buildBody({ businessName: null, brief: null }).system);
    expect(system).toMatch(/never invent a name, an age, a date/i);
    expect(system).toContain("{firstName}");
  });

  it("asks for the placeholder rather than a name, which is what makes this safe", async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValue(reply(SIX));
    global.fetch = fetchMock as unknown as typeof fetch;

    await drafter.draftBirthdayMessages({ businessName: "Bright Sparks", brief: null });

    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://api.test/v1/messages");
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(typeof init.body).toBe("string");
    expect(init.body as string).toContain("{firstName}");
  });
});

describe("what comes back", () => {
  const drafter = new AnthropicMessageDrafter("sk-test", "claude-test", "https://api.test");

  afterEach(() => jest.restoreAllMocks());

  it("returns the drafts when the model does as it is asked", async () => {
    global.fetch = jest.fn().mockResolvedValue(reply(SIX)) as typeof fetch;
    await expect(
      drafter.draftBirthdayMessages({ businessName: null, brief: null }),
    ).resolves.toEqual(SIX);
  });

  it("refuses an upstream error rather than returning nothing quietly", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        fakeResponse({ ok: false, status: 401, text: "invalid x-api-key" }),
      ) as typeof fetch;
    await expect(
      drafter.draftBirthdayMessages({ businessName: null, brief: null }),
    ).rejects.toThrow(MessageDraftingError);
  });

  it("reads a list the model wrapped in prose or a code fence", () => {
    // It is told to return a bare array. Asking politely is not a parser.
    expect(usableDrafts('Here you go:\n```json\n["One {firstName}"]\n```')).toEqual([
      "One {firstName}",
    ]);
  });

  it("drops a draft too long to fit on a card", () => {
    const long = "x".repeat(STANDING_ORDER_MESSAGE_MAX_LENGTH + 1);
    expect(usableDrafts(JSON.stringify(["Fine one", long]))).toEqual(["Fine one"]);
  });

  it("drops blanks, non-strings and repeats", () => {
    expect(usableDrafts(JSON.stringify(["One", "", "  ", 7, null, "one", "Two"]))).toEqual([
      "One",
      "Two",
    ]);
  });

  it("never returns more than a press of the button asked for", () => {
    const many = Array.from({ length: MESSAGE_DRAFT_COUNT + 4 }, (_, i) => `Message ${i}`);
    expect(usableDrafts(JSON.stringify(many))).toHaveLength(MESSAGE_DRAFT_COUNT);
  });

  it("refuses text that is not a list at all", () => {
    expect(() => usableDrafts("I would rather not.")).toThrow(MessageDraftingError);
  });

  it("refuses a list with nothing usable in it, rather than showing an empty box", () => {
    expect(() => usableDrafts(JSON.stringify(["", "   ", 12]))).toThrow(MessageDraftingError);
  });
});
