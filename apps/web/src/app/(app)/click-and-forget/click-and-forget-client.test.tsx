import { buildCardDocument, type DesignDocument, type StandingOrder } from "@kudos/shared-types";
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
    messageDraftingAvailable: false,
    ...over,
  };
}

/** Everything in the library is offered; `chosen` names what the saved order
 *  already picked, which is what the warnings are computed from. */
function renderPage({
  over = {},
  lists = [],
  designs = [design()],
  chosen = [],
}: {
  over?: Partial<StandingOrder>;
  lists?: { id: string; name: string; memberCount: number }[];
  designs?: DesignOption[];
  chosen?: string[];
} = {}) {
  render(
    <ClickAndForgetClient
      initialOrder={order({
        designs: chosen.map((id) => ({
          savedDesignId: id,
          name: designs.find((d) => d.id === id)?.name ?? id,
          archived: false,
          takesMessage: true,
        })),
        ...over,
      })}
      designs={designs}
      lists={lists}
      templates={[]}
    />,
  );
}

describe("Click and forget", () => {
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

    beforeEach(() => apiMock.mockReset());

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
