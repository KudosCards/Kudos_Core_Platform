import { render, screen, waitFor } from "@testing-library/react";
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
