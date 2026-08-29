import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computeDispatchDate, isoDay, POSTAGE_LEAD_DAYS } from "@kudos/shared-types";
import { SendTimingPicker, type OccasionDatingSummary } from "./send-timing";

/**
 * "When should these cards go?" — reported as confusing, and in two places it
 * was wrong rather than merely unclear.
 *
 * It printed the *occasion* dates in a sentence saying the cards post on them.
 * A card for a 26 September birthday posts on the 21st, five working days
 * earlier under send-by-5 — and the screen named Saturdays, which are never
 * posting days. See ADR 0130 and the send-timing rewrite.
 *
 * Dates here are computed with the same engine the order uses rather than
 * hard-coded, so these tests keep asserting the truth when the calendar moves
 * rather than needing a rewrite each time they go stale.
 */
describe("SendTimingPicker", () => {
  const inDays = (n: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    return isoDay(d);
  };
  /** What the send will really do with an occasion on `iso`. */
  const postsFor = (iso: string) =>
    isoDay(computeDispatchDate(new Date(`${iso}T00:00:00.000Z`), POSTAGE_LEAD_DAYS.second_class));
  const pretty = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).formatToParts(new Date(`${iso}T00:00:00.000Z`));
    const at = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${at("weekday")} ${at("day")} ${at("month")}`;
  };

  const dating = (over: Partial<OccasionDatingSummary> = {}): OccasionDatingSummary => ({
    count: 1,
    total: 12,
    earliest: inDays(60),
    latest: inDays(60),
    skipped: 0,
    ...over,
  });

  function setup(occasionDating?: OccasionDatingSummary | null) {
    const onChange = jest.fn();
    render(
      <SendTimingPicker
        postageClass="second_class"
        value={null}
        onChange={onChange}
        occasionDating={occasionDating}
      />,
    );
    return { onChange };
  }

  it("names the day a card actually posts, not the day of the occasion", () => {
    // The reported bug. The occasion is 60 days out; the card leaves five
    // working days before that, and it is the posting day the sender needs.
    const occasion = inDays(60);
    setup(dating({ earliest: occasion, latest: occasion }));

    const option = screen.getByText(/Each card on its own occasion/).closest("label")!;
    expect(within(option).getByText(pretty(postsFor(occasion)))).toBeInTheDocument();
    // …and the occasion is still named, so the posting day makes sense.
    expect(option).toHaveTextContent(pretty(occasion));
    expect(postsFor(occasion)).not.toBe(occasion);
  });

  it("tells a skipped birthday apart from a contact who has none", () => {
    // These were folded together and both called "no occasion on file" — untrue
    // of the first, and it hid the only thing the sender could act on.
    setup(dating({ count: 1, total: 12, skipped: 6 }));

    const option = screen.getByText(/Each card on its own occasion/).closest("label")!;
    expect(option).toHaveTextContent(/5 have no birthday on file/);
    expect(option).toHaveTextContent(/6 have birthdays coming up that were skipped/);
    expect(within(option).getByRole("link", { name: "Approvals" })).toHaveAttribute(
      "href",
      "/approvals",
    );
  });

  it("does not claim a spread when every card posts the same day", () => {
    // "spread from Sat 26 Sept to Sat 26 Sept" is what a single dated card used
    // to produce.
    const occasion = inDays(60);
    setup(dating({ count: 1, total: 1, earliest: occasion, latest: occasion }));

    const option = screen.getByText(/Each card on its own occasion/).closest("label")!;
    expect(option).not.toHaveTextContent(/between/);
    expect(option).toHaveTextContent(/1 card posts/);
  });

  it("shows the year on a span that crosses into another one", () => {
    // Without it, "from Fri 4 Sept to Sat 19 Jun" reads backwards — and a
    // contact list's birthdays routinely cover twelve months.
    setup(dating({ count: 9, total: 12, earliest: inDays(30), latest: inDays(400) }));

    const option = screen.getByText(/Each card on its own occasion/).closest("label")!;
    const nextYear = new Date(`${inDays(400)}T00:00:00.000Z`).getUTCFullYear();
    expect(option).toHaveTextContent(String(nextYear));
  });

  it("never offers a posting day that has already been", () => {
    // An occasion closer than the lead computes a dispatch date in the past;
    // the send clamps it and so must the screen, or it promises a day gone by.
    const soon = inDays(1);
    setup(dating({ count: 1, total: 1, earliest: soon, latest: soon }));

    const option = screen.getByText(/Each card on its own occasion/).closest("label")!;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // Whatever day it names, it is not one before today.
    for (let back = 1; back <= 10; back++) {
      expect(option).not.toHaveTextContent(pretty(inDays(-back)));
    }
  });

  it("offers no occasion option when there is nothing to time to", () => {
    // An option that would do nothing is worse than no option (ADR 0159).
    setup(null);
    expect(screen.queryByText(/Each card on its own occasion/)).not.toBeInTheDocument();
    expect(screen.getByText(/As soon as possible/)).toBeInTheDocument();
  });

  it("starts with nothing chosen, so the sender has to decide", () => {
    // ADR 0159: never pre-tick. A send that goes out on a date nobody picked is
    // the failure this guards.
    setup(dating());
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
  });

  it("reports the choice the sender makes", async () => {
    const { onChange } = setup(dating());
    await userEvent.click(screen.getByText(/Each card on its own occasion/));
    expect(onChange).toHaveBeenCalledWith({ mode: "occasion" });
  });
});
