import {
  buildCardDocument,
  type ContactReadiness,
  type DesignDocument,
  type StandingOrder,
  type WalletProjection,
  type WalletSummary,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClickAndForgetClient, type DesignOption } from "./click-and-forget-client";

/**
 * The page somebody hands their birthdays over on.
 *
 * What is guarded here is everything that would let the page mislead: a card
 * that is not a birthday card, a card a message will never be printed on, an
 * instruction that is switched on but stopped, a smart-list audience, and
 * consent that has gone stale. The layout is free to change; these cannot.
 */

// The pool tiles render a saved design through Konva, which wants a canvas.
// The tests are about what the page says, not what it draws.
jest.mock("@/components/saved-design-thumb", () => ({
  SavedDesignThumb: () => <div data-testid="thumb" />,
}));

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const apiMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => apiMock(...args),
}));

/**
 * Both wordings, in one matcher.
 *
 * The first version of this asserted the singular only, so a test meant to
 * prove the page stays quiet passed with "2 of your cards are not birthday
 * cards" on the screen in front of it.
 */
const NOT_A_BIRTHDAY_CARD = /not (a )?birthday cards?/i;

const STATEMENT = [
  "You are asking Kudos to send cards for you without checking with you first.",
  "Each card is paid for from your wallet balance at the time it is sent.",
];

/** A card with a message block inside — the ordinary case. */
const WITH_MESSAGE = buildCardDocument(null, "Happy birthday!");

/**
 * Two blocks of text inside and no seeded id, so nothing can tell which one is
 * the message. Built by hand rather than from `buildCardDocument`: that seeds
 * an `inside-message` id, and the id wins over everything else beside it
 * (ADR 0260), so a document built that way is never ambiguous.
 */
const AMBIGUOUS: DesignDocument = {
  version: 1,
  pages: [
    { name: "front", elements: [] },
    {
      name: "inside-right",
      elements: [
        {
          kind: "text" as const,
          id: "a",
          text: "Happy Birthday!",
          x: 40,
          y: 40,
          fontFamily: "Helvetica",
          fontSize: 16,
          color: "#1a1a1a",
        },
        {
          kind: "text" as const,
          id: "b",
          text: "From all of us",
          x: 40,
          y: 200,
          fontFamily: "Helvetica",
          fontSize: 16,
          color: "#1a1a1a",
        },
      ],
    },
  ],
};

function design(over: Partial<DesignOption> = {}): DesignOption {
  return {
    id: "d1",
    name: "Balloons",
    document: WITH_MESSAGE,
    category: "birthday",
    ...over,
  };
}

function order(over: Partial<StandingOrder> = {}): StandingOrder {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    enabled: false,
    audience: { kind: "all" },
    postageClass: "second_class",
    designs: [],
    messages: [],
    active: false,
    blockers: [],
    consent: null,
    consentStatement: STATEMENT,
    consentVersion: 1,
    planAllows: true,
    audienceGone: false,
    messageDraftingAvailable: false,
    ...over,
  };
}

/** Everything in the library is offered; `chosen` names what the saved order
 *  already picked, which is what the warnings are computed from. */
function wallet(over: Partial<WalletSummary> = {}): WalletSummary {
  return {
    balanceMinor: 5000,
    currency: "gbp",
    entries: [],
    autoTopUp: {
      enabled: false,
      thresholdMinor: 1000,
      amountMinor: 5000,
      pausedAt: null,
      pausedReason: null,
    },
    ...over,
  };
}

function renderPage({
  over = {},
  lists = [],
  designs = [design()],
  chosen = [],
  unavailable = false,
  summary = wallet(),
  projection = null,
  readiness = null,
}: {
  over?: Partial<StandingOrder>;
  lists?: { id: string; name: string; memberCount: number }[];
  designs?: DesignOption[];
  chosen?: string[];
  summary?: WalletSummary | null;
  projection?: WalletProjection | null;
  readiness?: ContactReadiness | null;
  /** Null stands for a read that failed, which is not an empty instruction. */
  unavailable?: boolean;
} = {}) {
  const loaded = order({
    designs: chosen.map((id) => ({
      savedDesignId: id,
      name: designs.find((d) => d.id === id)?.name ?? id,
      archived: false,
      takesMessage: true,
    })),
    ...over,
  });
  render(
    <ClickAndForgetClient
      initialOrder={unavailable ? null : loaded}
      designs={designs}
      lists={lists}
      templates={[]}
      wallet={summary}
      projection={projection}
      initialReadiness={readiness}
    />,
  );
}

describe("Click and forget", () => {
  // Reset for every test, not just the drafting ones: a shared mock keeps its
  // calls, and "was never asked to save" quietly passed on somebody else's
  // save two tests earlier.
  beforeEach(() => apiMock.mockReset());

  describe("a birthday pool that knows it is one", () => {
    it("names a chosen card the catalog files under another occasion", () => {
      // The case this was written for. The pool accepts any saved design and the
      // instruction only ever sends birthdays, so without this somebody's
      // birthday arrives as a good-luck card, every year, in silence.
      renderPage({
        designs: [
          design(),
          design({ id: "d2", name: "Best of Luck Clover", category: "good luck" }),
        ],
        chosen: ["d1", "d2"],
      });
      const warning = screen.getByText(/One of your cards is not a birthday card/i).closest("p")!;
      expect(within(warning).getByText(/Best of Luck Clover \(Good Luck\)/)).toBeInTheDocument();
      // Named, and not blocked: it is still chosen and still saveable.
      expect(screen.getByRole("button", { name: /Best of Luck Clover/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("says nothing when every chosen card is a birthday card", () => {
      renderPage({ designs: [design()], chosen: ["d1"] });
      expect(screen.queryByText(NOT_A_BIRTHDAY_CARD)).not.toBeInTheDocument();
    });

    it("stays quiet about a design nobody filed under an occasion", () => {
      // A member's own artwork has no catalog row, and the sync writes
      // "uncategorised" for an empty cell. Neither is a claim that this is the
      // wrong card, and a warning we cannot stand behind is worse than none.
      renderPage({
        designs: [
          design({ id: "d2", name: "Our own photo", category: null }),
          design({ id: "d3", name: "Unfiled", category: "uncategorised" }),
        ],
        chosen: ["d2", "d3"],
      });
      expect(screen.queryByText(NOT_A_BIRTHDAY_CARD)).not.toBeInTheDocument();
    });

    it("only warns about cards that are actually chosen", () => {
      renderPage({
        designs: [design(), design({ id: "d2", name: "Get Well Soon", category: "get well" })],
        chosen: ["d1"],
      });
      expect(screen.queryByText(NOT_A_BIRTHDAY_CARD)).not.toBeInTheDocument();
    });
  });

  describe("cards a message will not reach", () => {
    it("names them, rather than counting them", () => {
      renderPage({
        designs: [design(), design({ id: "d2", name: "Hand-built card", document: AMBIGUOUS })],
        chosen: ["d1", "d2"],
      });
      // Scoped to the warning: the card's name is also on its tile in the grid,
      // and "it appears somewhere" would pass with the warning missing.
      const warning = screen.getByText(/One of your cards will not use these/i).closest("p")!;
      expect(within(warning).getByText(/Hand-built card/)).toBeInTheDocument();
    });

    it("says nothing about it when every card takes a message", () => {
      renderPage({ designs: [design()], chosen: ["d1"] });
      expect(screen.queryByText(/will not use these/i)).not.toBeInTheDocument();
    });
  });

  describe("what it says about itself", () => {
    it("does not claim to be running when something is stopping it", () => {
      renderPage({ over: { enabled: true, active: false, blockers: ["empty_pool", "consent"] } });
      expect(screen.getByText(/Switched on, but not running yet/i)).toBeInTheDocument();
      expect(screen.getByText(/at least one card design and one message/i)).toBeInTheDocument();
      expect(screen.getByText(/Nobody has agreed to how this works/i)).toBeInTheDocument();
      expect(screen.queryByText(/We are sending these cards for you/i)).not.toBeInTheDocument();
    });

    it("says it is running only when it actually is", () => {
      renderPage({ over: { enabled: true, active: true } });
      expect(screen.getByText(/We are sending these cards for you/i)).toBeInTheDocument();
    });

    it("names a chosen card that has been removed from the library", () => {
      renderPage({
        over: {
          designs: [
            { savedDesignId: "gone", name: "Retired card", archived: true, takesMessage: true },
          ],
        },
      });
      const warning = screen.getByText(/removed from your designs/i).closest("p")!;
      expect(within(warning).getByText(/Retired card/)).toBeInTheDocument();
    });
  });

  describe("the plan gate", () => {
    it("tells a Free account what it is looking at, without hiding any of it", () => {
      renderPage({ over: { planAllows: false } });
      expect(screen.getAllByText(/on Pro and above/i)).toHaveLength(2);
      expect(screen.getByRole("link", { name: /See plans/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Balloons/ })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /send them without asking me/i })).toBeDisabled();
    });

    it("will not let anybody switch it on before they have agreed", () => {
      renderPage();
      expect(screen.getByRole("checkbox", { name: /send them without asking me/i })).toBeDisabled();
      expect(screen.getByText(/Tick the box above first/i)).toBeInTheDocument();
    });
  });

  describe("who it covers", () => {
    it("refuses a smart-list audience out loud", () => {
      renderPage({
        over: {
          audience: { kind: "segment", segmentId: "22222222-2222-4222-8222-222222222222" },
          enabled: true,
          blockers: ["audience_unsupported"],
        },
      });
      expect(screen.getAllByText(/Smart lists change on their own/i).length).toBeGreaterThanOrEqual(
        1,
      );
      expect(screen.getByText(/currently pointed at a smart list/i)).toBeInTheDocument();
    });

    it("does not offer a list when the account has none", () => {
      renderPage();
      expect(screen.getByRole("radio", { name: /One of my lists/i })).toBeDisabled();
      expect(screen.getByText(/no lists yet/i)).toBeInTheDocument();
    });

    it("offers the account's lists with their sizes", () => {
      renderPage({
        over: { audience: { kind: "list", listId: "l1" } },
        lists: [{ id: "l1", name: "Year 4 class", memberCount: 28 }],
      });
      expect(screen.getByRole("radio", { name: /One of my lists/i })).not.toBeDisabled();
      expect(screen.getByRole("option", { name: "Year 4 class (28)" })).toBeInTheDocument();
    });
  });

  describe("what it covers", () => {
    /**
     * The gap between "contacts" and "contacts a card can reach" is the thing
     * somebody would otherwise learn one skip notice at a time.
     */

    const readiness = (over: Partial<ContactReadiness> = {}): ContactReadiness => ({
      total: 26,
      withDateOfBirth: 24,
      withPostalAddress: 22,
      sendable: 22,
      ...over,
    });

    it("says how many will actually get a card, and why the others will not", () => {
      renderPage({ readiness: readiness() });
      expect(screen.getByText(/22 of 26/)).toBeInTheDocument();
      expect(screen.getByText(/2 have no birthday on file/)).toBeInTheDocument();
      expect(screen.getByText(/2 have no postal address/)).toBeInTheDocument();
    });

    it("says nothing about gaps when there are none", () => {
      renderPage({
        readiness: readiness({
          total: 10,
          withDateOfBirth: 10,
          withPostalAddress: 10,
          sendable: 10,
        }),
      });
      expect(screen.getByText(/10 of 10/)).toBeInTheDocument();
      expect(screen.queryByText(/no birthday on file/)).not.toBeInTheDocument();
    });

    it("points an empty address book at adding some", () => {
      renderPage({
        readiness: readiness({ total: 0, withDateOfBirth: 0, withPostalAddress: 0, sendable: 0 }),
      });
      expect(screen.getByText(/no contacts here yet/i)).toBeInTheDocument();
    });

    it("says nothing at all rather than a number it could not fetch", () => {
      renderPage({ readiness: null });
      expect(screen.queryByText(/will get a card/i)).not.toBeInTheDocument();
      // And emphatically not this: a count that failed is not the same as an
      // empty address book, and telling somebody they have no contacts when
      // they have four hundred is worse than telling them nothing.
      expect(screen.queryByText(/no contacts here yet/i)).not.toBeInTheDocument();
    });

    it("counts the list again when the audience changes", async () => {
      // A page still reading "26 contacts" after somebody picked a list of four
      // has told them something false about what they are switching on.
      const user = userEvent.setup();
      apiMock.mockResolvedValue({
        total: 4,
        withDateOfBirth: 4,
        withPostalAddress: 4,
        sendable: 4,
      });
      renderPage({
        readiness: readiness(),
        lists: [{ id: "l1", name: "Year 4 class", memberCount: 4 }],
      });

      await user.click(screen.getByRole("radio", { name: /One of my lists/i }));

      expect(await screen.findByText(/4 of 4/)).toBeInTheDocument();
      expect(apiMock).toHaveBeenCalledWith("/recipients/readiness?listId=l1");
    });
  });

  describe("the money", () => {
    const projection = (over: Partial<WalletProjection> = {}): WalletProjection => ({
      balanceMinor: 5000,
      committedMinor: 9000,
      cardsTotal: 9,
      cardsCovered: 6,
      firstShortfall: { dispatchDate: new Date("2026-10-14"), recipientName: "Grace Bell" },
      ...over,
    });

    it("shows the balance beside the promise that spends it", () => {
      renderPage({ summary: wallet({ balanceMinor: 5000 }) });
      expect(screen.getByText(/£50/)).toBeInTheDocument();
    });

    it("names the first card the balance will not reach", () => {
      renderPage({ projection: projection() });
      expect(screen.getByText(/covers the next 6 of 9 cards/i)).toBeInTheDocument();
      expect(screen.getByText(/Grace Bell/)).toBeInTheDocument();
      expect(screen.getByText(/14 October/)).toBeInTheDocument();
    });

    it("says so plainly when the balance covers everything", () => {
      renderPage({ projection: projection({ cardsCovered: 9, firstShortfall: null }) });
      expect(screen.getByText(/covers all 9 cards/i)).toBeInTheDocument();
      expect(screen.queryByText(/will not reach/i)).not.toBeInTheDocument();
    });

    it("offers the automatic top-up here, with its own name on its own button", () => {
      renderPage();
      // Two buttons reading "Save" would be a page that cannot tell you which
      // of your changes it kept.
      expect(screen.getByRole("button", { name: "Save top-up settings" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("shows none of it when the wallet could not be read", () => {
      renderPage({ summary: null });
      expect(screen.queryByText(/Your wallet holds/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Save top-up settings" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("things a review found", () => {
    /**
     * Each of these is a bug that shipped, and each test is written so that it
     * fails against the code as it was.
     */

    it("renders the shortfall date the API actually sends, which is a string", () => {
      // `apiFetch` casts its response, it does not parse it — so every date in
      // a payload is a string at runtime however the type reads. This called
      // `.toLocaleDateString()` on it, which threw, and only for the
      // subscribers whose balance was short. The unit test passed a real Date
      // and never saw it.
      const fromTheWire = {
        balanceMinor: 5000,
        committedMinor: 9000,
        cardsTotal: 9,
        cardsCovered: 6,
        firstShortfall: { dispatchDate: "2026-10-14T00:00:00.000Z", recipientName: "Grace Bell" },
      } as unknown as WalletProjection;

      renderPage({ projection: fromTheWire });
      expect(screen.getByText(/14 October/)).toBeInTheDocument();
    });

    it("does not tick Everybody when the list it was sending to has been deleted", () => {
      // Both id columns are SET NULL, so a deleted list leaves a row that looks
      // like a deliberate "everybody". The page ticked it, and one press of
      // Save would have turned thirty children into every contact on the
      // account.
      renderPage({ over: { audienceGone: true } });
      expect(screen.getByRole("radio", { name: /Everybody/i })).not.toBeChecked();
      expect(screen.getByRole("radio", { name: /One of my lists/i })).not.toBeChecked();
      expect(screen.getByText(/has been deleted/i)).toBeInTheDocument();
    });

    it("refuses to save a deleted-list audience until somebody chooses", async () => {
      const user = userEvent.setup();
      renderPage({ over: { audienceGone: true } });

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText(/choose who gets a card before saving/i)).toBeInTheDocument();
      expect(apiMock).not.toHaveBeenCalledWith("/standing-order", expect.anything());
    });

    it("refuses to turn a smart-list audience into everybody by itself", async () => {
      // The page warns about a smart list and then, on Save, quietly sent
      // `{kind: "all"}` — which is the same widening by a different route.
      const user = userEvent.setup();
      renderPage({
        over: { audience: { kind: "segment", segmentId: "22222222-2222-4222-8222-222222222222" } },
      });

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText(/choose who gets a card before saving/i)).toBeInTheDocument();
      expect(apiMock).not.toHaveBeenCalledWith("/standing-order", expect.anything());
    });

    it("saves a real choice once one is made", async () => {
      const user = userEvent.setup();
      renderPage({ over: { audienceGone: true } });

      await user.click(screen.getByRole("radio", { name: /Everybody/i }));
      apiMock.mockResolvedValueOnce(order());
      await user.click(screen.getByRole("button", { name: "Save" }));

      const save = apiMock.mock.calls.find(([path]) => path === "/standing-order");
      expect(save).toBeDefined();
      expect(JSON.parse(String((save![1] as RequestInit).body))).toMatchObject({
        audience: { kind: "all" },
      });
    });

    it("will not offer to save over an instruction it could not read", async () => {
      // A failed read rendered as "nothing configured", with a live Save button
      // over somebody's real instruction.
      const user = userEvent.setup();
      renderPage({ unavailable: true });

      expect(screen.getByText(/could not load your settings/i)).toBeInTheDocument();
      const save = screen.getByRole("button", { name: "Save" });
      expect(save).toBeDisabled();

      await user.click(save);
      expect(apiMock).not.toHaveBeenCalledWith("/standing-order", expect.anything());
    });
  });

  describe("consent", () => {
    it("shows the wording somebody is agreeing to, rather than a bare tickbox", () => {
      renderPage();
      for (const line of STATEMENT) {
        expect(screen.getByText(line)).toBeInTheDocument();
      }
    });

    it("asks again when the wording has changed since they agreed", () => {
      renderPage({ over: { consent: { consentedAt: new Date(), version: 0, current: false } } });
      expect(screen.getByText(/agreed to an earlier version/i)).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: /I have read this and I agree/i }),
      ).not.toBeChecked();
    });
  });

  describe("writing the messages", () => {
    it("puts the merge field in at the caret, not at the end", async () => {
      // Typing `{firstName}` from memory is what this replaces, so dropping it
      // in the wrong place would be no better than the textarea it replaced.
      const user = userEvent.setup();
      renderPage();
      const box = screen.getByRole("textbox", { name: "Message 1" });
      await user.type(box, "Happy birthday ");
      await user.type(box, "!");
      await user.type(box, "{ArrowLeft}");
      await user.click(screen.getByRole("button", { name: "+ First name" }));
      expect(box).toHaveValue("Happy birthday {firstName}!");
    });

    it("offers the same merge fields the design editor does", () => {
      renderPage();
      const fields = screen.getByRole("combobox", {
        name: /Insert a merge field into message 1/i,
      });
      expect(within(fields).getByRole("option", { name: "Last name" })).toBeInTheDocument();
      expect(within(fields).getByRole("option", { name: "Occasion" })).toBeInTheDocument();
    });
  });

  describe("suggested messages", () => {
    /**
     * The drafts are suggestions and nothing more: they are not written into
     * the pool, they do not replace anything, and they are not saved until the
     * subscriber saves the page like anything else.
     */

    const drafted = ["Many happy returns, {firstName}!", "Have a brilliant day, {firstName}."];

    function mockDrafts(drafts: string[] = drafted) {
      apiMock.mockResolvedValue({ drafts });
      return apiMock;
    }

    it("offers nothing at all when the server cannot draft", () => {
      renderPage({ over: { messageDraftingAvailable: false } });
      expect(screen.queryByRole("button", { name: /Suggest messages/i })).not.toBeInTheDocument();
    });

    it("asks for drafts and shows them without touching the pool", async () => {
      const user = userEvent.setup();
      mockDrafts();
      renderPage({ over: { messageDraftingAvailable: true } });

      await user.type(screen.getByRole("textbox", { name: "Message 1" }), "My own words");
      await user.click(screen.getByRole("button", { name: /Suggest messages/i }));

      expect(await screen.findByText(drafted[0]!)).toBeInTheDocument();
      // Still theirs, untouched.
      expect(screen.getByRole("textbox", { name: "Message 1" })).toHaveValue("My own words");
      expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it("sends the note, and nothing else", async () => {
      const user = userEvent.setup();
      mockDrafts();
      renderPage({ over: { messageDraftingAvailable: true } });

      await user.type(
        screen.getByRole("textbox", { name: /What should they sound like/i }),
        "warm, a bit funny",
      );
      await user.click(screen.getByRole("button", { name: /Suggest messages/i }));

      await screen.findByText(drafted[0]!);
      const [path, init] = apiMock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe("/standing-order/message-drafts");
      expect(JSON.parse(String(init.body))).toEqual({ brief: "warm, a bit funny" });
    });

    it("puts a kept draft in the pool, and only when it is kept", async () => {
      const user = userEvent.setup();
      mockDrafts();
      renderPage({ over: { messageDraftingAvailable: true } });

      await user.click(screen.getByRole("button", { name: /Suggest messages/i }));
      await screen.findByText(drafted[0]!);
      expect(screen.getByRole("textbox", { name: "Message 1" })).toHaveValue("");

      await user.click(screen.getAllByRole("button", { name: "Keep" })[0]!);
      expect(screen.getByRole("textbox", { name: "Message 1" })).toHaveValue(drafted[0]!);
      // Kept ones leave the suggestion list; the other is still on offer.
      expect(screen.getByText(drafted[1]!)).toBeInTheDocument();
    });

    it("records a kept draft as assisted, and a typed one as written", async () => {
      // The distinction the schema has carried since C4 and nothing ever wrote.
      // A message somebody kept from a model is not the same promise as one
      // they wrote, and the pool is the only place that can still tell.
      const user = userEvent.setup();
      mockDrafts();
      renderPage({ over: { messageDraftingAvailable: true } });

      await user.type(screen.getByRole("textbox", { name: "Message 1" }), "My own words");
      await user.click(screen.getByRole("button", { name: /Suggest messages/i }));
      await screen.findByText(drafted[0]!);
      await user.click(screen.getAllByRole("button", { name: "Keep" })[0]!);

      apiMock.mockResolvedValueOnce(order({ messageDraftingAvailable: true }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      const save = apiMock.mock.calls.find(
        ([path, init]) => path === "/standing-order" && (init as RequestInit).method === "PUT",
      );
      expect(save).toBeDefined();
      const body = JSON.parse(String((save![1] as RequestInit).body)) as {
        messages: { text: string; source: string }[];
      };
      expect(body.messages).toEqual([
        { text: "My own words", source: "written" },
        { text: drafted[0]!, source: "assisted" },
      ]);
    });

    it("throws one away without putting it anywhere", async () => {
      const user = userEvent.setup();
      mockDrafts();
      renderPage({ over: { messageDraftingAvailable: true } });

      await user.click(screen.getByRole("button", { name: /Suggest messages/i }));
      await screen.findByText(drafted[0]!);
      await user.click(screen.getByRole("button", { name: `Discard: ${drafted[0]!}` }));

      expect(screen.queryByText(drafted[0]!)).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Message 1" })).toHaveValue("");
    });

    it("says so when it cannot, and leaves the written messages alone", async () => {
      const user = userEvent.setup();
      // The API's own words, not a generic fallback: the server says whether
      // this was a limit, a refusal or an outage, and the page passes it on.
      apiMock.mockRejectedValue(
        new ApiError("We could not write any suggestions just now.", 503, null),
      );
      renderPage({ over: { messageDraftingAvailable: true } });

      await user.type(screen.getByRole("textbox", { name: "Message 1" }), "My own words");
      await user.click(screen.getByRole("button", { name: /Suggest messages/i }));

      expect(await screen.findByText(/could not write any suggestions/i)).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Message 1" })).toHaveValue("My own words");
    });
  });

  describe("saving", () => {
    it("says when there is something to save, and when there is not", async () => {
      const user = userEvent.setup();
      renderPage();
      expect(screen.getByText(/Everything here is saved/i)).toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: /I have read this and I agree/i }));
      expect(screen.getByText(/You have unsaved changes/i)).toBeInTheDocument();
    });
  });

  it("points somebody with no designs at the catalog and at their own artwork", () => {
    renderPage({ designs: [] });
    expect(screen.getByRole("link", { name: /make your own/i })).toBeInTheDocument();
  });
});
