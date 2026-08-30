import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecipientsClient } from "./recipients-client";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/recipients",
}));

/**
 * A school imports 500 contacts and 120 rows are rejected — bad postcodes,
 * dates that aren't dd/mm/yyyy. The report naming every rejected row and its
 * reason was built, rendered, and then destroyed in the same commit, because
 * the parent closed the dialog the moment the import returned and the Modal
 * unmounts its children when closed.
 *
 * They found out weeks later, when 120 birthdays never produced a card.
 * See ADR 0198.
 */
describe("RecipientsClient — the CSV import report", () => {
  const SUMMARY = {
    created: 380,
    updated: 0,
    rejected: [
      { row: 7, reason: "Postcode is not a valid UK postcode" },
      { row: 9, reason: "Date of birth must be dd/mm/yyyy" },
    ],
    warnings: [],
  };

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/recipients/import/preview")) {
        return Promise.resolve({
          totalRows: 500,
          columns: ["First", "Last"],
          sampleRows: [],
          suggestedMapping: { firstName: "First", lastName: "Last" },
        });
      }
      if (String(url).includes("/recipients/import")) return Promise.resolve(SUMMARY);
      if (String(url).includes("/recipient-lists")) return Promise.resolve([]);
      return Promise.resolve({ items: [], total: 0, page: 1 });
    });
  });

  async function importACsv() {
    render(
      <RecipientsClient
        initialRecipients={[]}
        initialTotal={0}
        initialPage={1}
        initialLists={[]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    const file = new File(["First,Last\nAda,Lovelace\n"], "contacts.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText("Choose a CSV file"), file);
    await screen.findByRole("button", { name: /Import 500 contacts/ });
    await userEvent.click(screen.getByRole("button", { name: /Import 500 contacts/ }));
  }

  it("still shows what was rejected, and why, after the import returns", async () => {
    await importACsv();

    // The counts, and the per-row reasons behind them. Without these the page
    // simply reads 380 and says nothing about the rows that were dropped. It
    // now appears twice — in the dialog and on the page behind it — so this
    // asserts on both rather than picking one.
    await waitFor(() => expect(screen.getAllByText(/Imported 380 new/)).toHaveLength(2));
    expect(screen.getAllByText(/2 rows couldn.t be imported/)).toHaveLength(2);
    expect(screen.getAllByText(/Row 7: Postcode is not a valid UK postcode/)).toHaveLength(2);
  });

  it("keeps the report on the page after the dialog is closed", async () => {
    await importACsv();
    await waitFor(() => expect(screen.getAllByText(/Imported 380 new/)).toHaveLength(2));

    // A run that dropped rows should not stop existing because a dialog was
    // dismissed — the report is what tells them 120 birthdays will never
    // produce a card.
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByText(/Imported 380 new/)).toBeInTheDocument();
    expect(screen.getByText(/Row 7: Postcode is not a valid UK postcode/)).toBeInTheDocument();

    // And it can be dismissed once read.
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Imported 380 new/)).not.toBeInTheDocument();
  });

  it("says nothing extra on the page when every row imported cleanly", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/recipients/import/preview")) {
        return Promise.resolve({
          totalRows: 500,
          columns: ["First", "Last"],
          sampleRows: [],
          suggestedMapping: { firstName: "First", lastName: "Last" },
        });
      }
      if (String(url).includes("/recipients/import")) {
        return Promise.resolve({ created: 500, updated: 0, rejected: [], warnings: [] });
      }
      if (String(url).includes("/recipient-lists")) return Promise.resolve([]);
      return Promise.resolve({ items: [], total: 0, page: 1 });
    });
    await importACsv();

    // A clean import needs no banner following the user around the page.
    await waitFor(() => expect(screen.getAllByText(/Imported 500 new/)).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/Imported 500 new/)).not.toBeInTheDocument();
  });
});

/**
 * The bulk-action bar counts every tick across every page, and the "Send a card
 * to N" link genuinely carries all of them — but Export and Archive quietly
 * intersected the selection with the rendered page. Same toolbar, same
 * selection, two different meanings. See ADR 0199.
 */
describe("RecipientsClient — bulk actions across pages", () => {
  const person = (i: number) =>
    ({
      id: `r-${i}`,
      firstName: "Child",
      lastName: `Number${i}`,
      status: "active",
      source: "manual",
      dateOfBirth: null,
      addressLine1: "1 Test Street",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
      email: null,
      createdAt: new Date().toISOString(),
    }) as never;

  // A full page, then a short second one — the shape that makes the two
  // meanings of "selected" diverge.
  const PAGE_ONE = Array.from({ length: 30 }, (_, i) => person(i + 1));
  const PAGE_TWO = [person(31), person(32)];
  const TOTAL = 32;

  let capturedCsv: string | null;

  beforeEach(() => {
    capturedCsv = null;
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/recipient-lists")) return Promise.resolve([]);
      if (String(url).includes("page=2")) {
        return Promise.resolve({ items: PAGE_TWO, total: TOTAL, page: 2 });
      }
      if (String(url).startsWith("/recipients?")) {
        return Promise.resolve({ items: PAGE_ONE, total: TOTAL, page: 1 });
      }
      return Promise.resolve({});
    });
    // jsdom has no object-URL plumbing, and its Blob has no text(). Read the
    // CSV out of the constructor instead.
    const RealBlob = global.Blob;
    jest
      .spyOn(global, "Blob")
      .mockImplementation((parts?: BlobPart[], options?: BlobPropertyBag) => {
        capturedCsv = String(parts?.[0] ?? "");
        return new RealBlob(parts, options);
      });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:stub",
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  });

  /** The table and the phone card-list both render a checkbox per contact, so
   * both are in the DOM under jsdom. Either drives the same state; take one. */
  const tickAllOnPage = async () =>
    userEvent.click(screen.getAllByLabelText("Select all on this page")[0]!);

  /** The bulk-action bar, found via its own counter — per-row buttons share
   * these labels. */
  const bulkBar = () => screen.getByText(/^\d+ selected$/).closest("div")!.parentElement!;

  async function selectAcrossBothPages(lists: never[] = []) {
    render(
      <RecipientsClient
        initialRecipients={PAGE_ONE}
        initialTotal={TOTAL}
        initialPage={1}
        initialLists={lists}
      />,
    );
    await tickAllOnPage();
    expect(screen.getByText("30 selected")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findAllByText("Child Number31");
    await tickAllOnPage();

    // The counter has always told the truth about how many are ticked.
    expect(screen.getByText("32 selected")).toBeInTheDocument();
  }

  it("exports every ticked contact, not just the ones still on screen", async () => {
    await selectAcrossBothPages();
    await userEvent.click(within(bulkBar()).getByRole("button", { name: "Export" }));

    await waitFor(() => expect(capturedCsv).not.toBeNull());
    const csv = capturedCsv!;
    const rows = csv.trim().split("\n").slice(1);
    expect(rows).toHaveLength(32);
    expect(csv).toContain("Number1");
    expect(csv).toContain("Number32");
  });

  it("carries every ticked id to the send flow", async () => {
    await selectAcrossBothPages();

    // This link always worked across pages — it is the reason the toolbar's
    // count and its actions disagreed. It is asserted here because changing the
    // selection's shape is exactly how a working link quietly stops working:
    // spreading a Map yields [key, value] pairs, and `.join(",")` accepts that
    // without a word from the type checker.
    const href = within(bulkBar())
      .getByRole("link", { name: /Send a card to 32/ })
      .getAttribute("href");
    expect(href).toBe(
      `/send?recipients=${Array.from({ length: 32 }, (_, i) => `r-${i + 1}`).join(",")}`,
    );
  });

  it("adds every ticked contact to a list", async () => {
    const list = { id: "l-1", name: "Year 6", memberCount: 0, sample: [] } as unknown as never;
    await selectAcrossBothPages([list]);

    await userEvent.selectOptions(
      within(bulkBar()).getByLabelText("Add selected to a list"),
      "l-1",
    );

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url]) => String(url).includes("/members"));
      expect(post).toBeDefined();
      const body = JSON.parse((post![1] as { body: string }).body) as { recipientIds: string[] };
      // Contents, not just the count: spreading a Map gives 32 [key, value]
      // pairs, which passes a length check and sends nonsense to the API.
      expect(body.recipientIds).toEqual(Array.from({ length: 32 }, (_, i) => `r-${i + 1}`));
    });
  });

  it("archives every ticked contact, not just the ones still on screen", async () => {
    await selectAcrossBothPages();
    await userEvent.click(within(bulkBar()).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(
        ([, init]) => (init as { method?: string } | undefined)?.method === "DELETE",
      );
      expect(deletes).toHaveLength(32);
    });
  });
});

/**
 * Pick "January" in the birthday-month filter, then "March" a beat later. If
 * January is slower its response lands second and overwrites the March results:
 * the select says March, the table shows January, and total/page are desynced
 * with it. See ADR 0201.
 */
describe("RecipientsClient — a slower earlier response", () => {
  const named = (name: string) =>
    ({
      id: `r-${name}`,
      firstName: name,
      lastName: "Contact",
      status: "active",
      source: "manual",
      dateOfBirth: null,
      addressLine1: "1 Test Street",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
      email: null,
      createdAt: new Date().toISOString(),
    }) as never;

  beforeEach(() => fetchMock.mockReset());

  it("keeps the newer results when the older request lands last", async () => {
    // Hold January open; let March answer immediately. Nothing here depends on
    // timing luck — the order is the one the bug needs, made explicit.
    let releaseJanuary!: (value: unknown) => void;
    const january = new Promise((resolve) => {
      releaseJanuary = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/recipient-lists")) return Promise.resolve([]);
      if (String(url).includes("birthMonth=1")) return january;
      if (String(url).includes("birthMonth=3")) {
        return Promise.resolve({ items: [named("March")], total: 1, page: 1 });
      }
      return Promise.resolve({ items: [], total: 0, page: 1 });
    });

    render(
      <RecipientsClient
        initialRecipients={[]}
        initialTotal={0}
        initialPage={1}
        initialLists={[]}
      />,
    );
    const filter = screen.getByLabelText("Filter by birthday month");
    await userEvent.selectOptions(filter, "1");
    await userEvent.selectOptions(filter, "3");
    // The row's checkbox is labelled with the exact name; the visible name node
    // also carries the address, so an exact-text query would not match it.
    const shown = (name: string) => screen.queryAllByLabelText(`Select ${name} Contact`);
    await waitFor(() => expect(shown("March").length).toBeGreaterThan(0));

    releaseJanuary({ items: [named("January")], total: 1, page: 1 });
    await january;

    // The filter still says March, so the table must too.
    await waitFor(() => expect(shown("January")).toHaveLength(0));
    expect(shown("March").length).toBeGreaterThan(0);
    expect((filter as HTMLSelectElement).value).toBe("3");
  });
});
