import type { RecipientListSummary, SegmentSummary, SegmentsOverview } from "@kudos/shared-types";
import { render, screen, within } from "@testing-library/react";
import { ListsClient } from "./lists-client";

/**
 * The Lists index. Two things here are worth guarding: the page must not offer
 * to save a suggestion the account already has (the old page did, and the
 * "saved" copy then sat beside the identical suggestion doing nothing), and a
 * list of people we cannot post to must not lead with "Send to this list".
 */

const MISSING_ADDRESS = { contact: { hasMailableAddress: false } } as const;

function smart(over: Partial<SegmentSummary> = {}): SegmentSummary {
  return {
    id: null,
    key: "missing-address",
    name: "Missing an address",
    description: "Active contacts we can't post to yet.",
    definition: MISSING_ADDRESS,
    count: 2,
    sample: [{ recipientId: "r1", name: "Noor Haddad", detail: "No postal address" }],
    suggested: true,
    ...over,
  };
}

function picked(over: Partial<RecipientListSummary> = {}): RecipientListSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Year 4 class",
    memberCount: 3,
    sample: [{ id: "r2", firstName: "Tom", lastName: "Ellis" }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function renderPage(overview: Partial<SegmentsOverview>, lists: RecipientListSummary[] = []) {
  render(
    <ListsClient initialPicked={lists} initialSmart={{ suggested: [], saved: [], ...overview }} />,
  );
}

it("leads an unpostable list with the fix, not a send", () => {
  renderPage({ suggested: [smart()] });
  const card = screen.getByText("Missing an address").closest<HTMLElement>("div.card")!;
  expect(within(card).getByRole("link", { name: /Add their addresses/ })).toHaveAttribute(
    "href",
    "/recipients?missingAddress=true",
  );
  expect(within(card).queryByRole("link", { name: /Send to this list/ })).not.toBeInTheDocument();
});

it("still offers Send on a list we can post to", () => {
  renderPage({
    suggested: [
      smart({
        key: "upcoming-birthdays",
        name: "Upcoming birthdays",
        definition: { occasion: { types: ["birthday"], window: { kind: "next_days", days: 30 } } },
      }),
    ],
  });
  expect(screen.getByRole("link", { name: /Send to this list/ })).toHaveAttribute(
    "href",
    "/send?segment=upcoming-birthdays",
  );
});

it("stops offering a suggestion once the same rule is already saved", () => {
  renderPage({
    suggested: [smart()],
    saved: [
      smart({
        id: "22222222-2222-4222-8222-222222222222",
        key: "22222222-2222-4222-8222-222222222222",
        name: "Chase addresses",
        suggested: false,
      }),
    ],
  });
  // The rule is saved under the customer's own name, so the ready-made copy of
  // it is no longer on offer — the old page showed both and "Save" appeared to
  // do nothing.
  expect(screen.queryByText("Suggested smart lists")).not.toBeInTheDocument();
  expect(screen.getByText("Chase addresses")).toBeInTheDocument();
});

it("shows both kinds together, counted separately", () => {
  renderPage(
    {
      saved: [
        smart({
          id: "33333333-3333-4333-8333-333333333333",
          key: "33333333-3333-4333-8333-333333333333",
          name: "Chase addresses",
          suggested: false,
        }),
      ],
    },
    [picked()],
  );
  expect(screen.getByRole("button", { name: /All\s*2/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Picked by hand\s*1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Updates itself\s*1/ })).toBeInTheDocument();
});

it("sends to a hand-picked list in one click, the same as a smart one", () => {
  renderPage({}, [picked()]);
  // Before this, a hand-picked list had no send path at all: you filtered the
  // composer's picker to it and ticked every member by hand.
  expect(screen.getByRole("link", { name: /Send to this list/ })).toHaveAttribute(
    "href",
    "/send?list=11111111-1111-4111-8111-111111111111",
  );
});

it("tells a brand-new account what a list is for", () => {
  renderPage({});
  expect(screen.getByText("No lists yet")).toBeInTheDocument();
  expect(screen.getByText(/a group you send to in one go/)).toBeInTheDocument();
});
