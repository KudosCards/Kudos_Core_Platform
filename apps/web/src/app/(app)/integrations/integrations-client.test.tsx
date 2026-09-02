import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CrmConnection } from "@kudos/shared-types";
import { IntegrationsClient } from "./integrations-client";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/integrations",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * A CRM pull that stops at the provider's paging cap is a partial import. The
 * screen used to render every finished sync in green — so a portal with more
 * contacts than one sync can read told the customer "Imported 5,000" and said
 * nothing about the 7,000 that never arrived. See ADR 0209.
 */
describe("IntegrationsClient — a partial import says so", () => {
  const connection: CrmConnection = {
    provider: "hubspot",
    syncEnabled: true,
    lastSyncedAt: new Date("2026-08-01T09:00:00.000Z"),
    lastSyncStatus: "ok",
    createdAt: new Date("2026-07-01T09:00:00.000Z"),
  };

  function renderClient() {
    render(
      <IntegrationsClient
        initialKeys={[]}
        initialConnections={[connection]}
        apiBaseUrl="https://api.test"
        connectedProvider={null}
        errorProvider={null}
        errorReason={null}
      />,
    );
  }

  beforeEach(() => fetchMock.mockReset());

  /**
   * A grant with no location is refused at the callback now, and the page has to
   * say which of GoHighLevel's two choices went wrong. "Please try again" is
   * what sent one customer round the same failing loop five times. See ADR 0213.
   */
  it("names the wrong choice when a grant came back without a location", () => {
    render(
      <IntegrationsClient
        initialKeys={[]}
        initialConnections={[]}
        apiBaseUrl="https://api.test"
        connectedProvider={null}
        errorProvider="gohighlevel"
        errorReason="no_location"
      />,
    );

    const banner = screen.getByText(/agency rather than one of its sub-accounts/i);
    expect(banner).toHaveTextContent(/choose the sub-account/i);
    expect(banner).not.toHaveTextContent(/Please try again/i);
  });

  it("falls back to the general message when we do not know what went wrong", () => {
    render(
      <IntegrationsClient
        initialKeys={[]}
        initialConnections={[]}
        apiBaseUrl="https://api.test"
        connectedProvider={null}
        errorProvider="gohighlevel"
        errorReason={null}
      />,
    );

    expect(screen.getByText(/We couldn't connect GoHighLevel/i)).toBeInTheDocument();
  });

  it("warns that contacts were left behind when the pull was truncated", async () => {
    fetchMock.mockResolvedValue({
      fetched: 5000,
      created: 4800,
      updated: 100,
      skipped: 100,
      duplicates: 0,
      unmappable: 0,
      errors: [],
      truncated: true,
      readiness: {
        total: 5000,
        withDateOfBirth: 5000,
        withPostalAddress: 5000,
        sendable: 5000,
      },
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const summary = await screen.findByText(/partial import/i);
    expect(summary).toHaveTextContent("Imported 4800 new");
    expect(summary).toHaveTextContent(/more contacts than one sync can read/i);
    // Green is reserved for a complete import; this must not read as success.
    expect(summary.className).not.toContain("success");
    // And the "Last synced" line stops claiming ok until the page reloads.
    await waitFor(() => expect(screen.getByText(/partial: some contacts/i)).toBeInTheDocument());
  });

  /**
   * A card needs a birthday and a postal address, and both are optional in every
   * CRM we read — so "Imported 500" can mean twelve people get a card. The
   * summary says how many are actually reachable, and which field is missing.
   * See ADR 0214.
   */
  it("says how many of the imported contacts can actually be sent a card", async () => {
    fetchMock.mockResolvedValue({
      fetched: 500,
      created: 500,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      unmappable: 0,
      errors: [],
      truncated: false,
      readiness: {
        total: 500,
        withDateOfBirth: 38,
        withPostalAddress: 20,
        sendable: 12,
      },
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const summary = await screen.findByText(/12 of 500/);
    expect(summary).toHaveTextContent(/ready to be sent a card/i);
    expect(summary).toHaveTextContent(/462 without a date of birth/);
    expect(summary).toHaveTextContent(/480 without a postal address/);
    // "Imported 500 new" in green would be a lie when 12 can be reached.
    expect(summary.className).not.toContain("success");
  });

  it("names only the field that is actually missing", async () => {
    fetchMock.mockResolvedValue({
      fetched: 10,
      created: 10,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      unmappable: 0,
      errors: [],
      truncated: false,
      readiness: { total: 10, withDateOfBirth: 10, withPostalAddress: 4, sendable: 4 },
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const summary = await screen.findByText(/4 of 10/);
    expect(summary).toHaveTextContent(/6 without a postal address/);
    expect(summary).not.toHaveTextContent(/without a date of birth/);
  });

  it("accounts for the contacts that never made it into the counts", async () => {
    // The everyday shape of a marketing list: a third of it is email-only
    // subscribers with no surname, so the mapper drops them before the ingest
    // ever sees them. The summary read "0 new, 97 updated (of 100 fetched)" —
    // in green — and left the customer to work out where the other three went.
    fetchMock.mockResolvedValue({
      fetched: 100,
      created: 0,
      updated: 97,
      skipped: 0,
      duplicates: 0,
      unmappable: 3,
      errors: [],
      truncated: false,
      readiness: { total: 97, withDateOfBirth: 97, withPostalAddress: 97, sendable: 97 },
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const summary = await screen.findByText(/Imported 0 new/);
    expect(summary).toHaveTextContent(/3 with no first or last name/i);
    // Three contacts short of the address book is not a clean success.
    expect(summary.className).not.toContain("success");
    // And the "Last synced" line must not say ok directly beneath a panel
    // that has just said three contacts did not arrive.
    await waitFor(() =>
      expect(screen.getByText(/3 of 100 contacts were not imported/i)).toBeInTheDocument(),
    );
  });

  it("names why a contact was refused rather than only counting it", async () => {
    fetchMock.mockResolvedValue({
      fetched: 2,
      created: 1,
      updated: 0,
      skipped: 1,
      duplicates: 0,
      unmappable: 0,
      errors: [
        {
          externalId: "20",
          reason:
            "Skipped: these details now match another contact already on file " +
            "(same name, postcode and date of birth)",
        },
      ],
      truncated: false,
      readiness: { total: 1, withDateOfBirth: 1, withPostalAddress: 1, sendable: 1 },
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    expect(await screen.findByText(/match another contact already on file/i)).toBeInTheDocument();
    // The contact is named, so the customer knows which one to go and fix.
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("counts a repeated contact as a duplicate rather than losing it", async () => {
    fetchMock.mockResolvedValue({
      fetched: 4,
      created: 3,
      updated: 0,
      skipped: 0,
      duplicates: 1,
      unmappable: 0,
      errors: [],
      truncated: false,
      readiness: { total: 3, withDateOfBirth: 3, withPostalAddress: 3, sendable: 3 },
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const summary = await screen.findByText(/Imported 3 new/);
    expect(summary).toHaveTextContent(/1 listed twice/i);
  });

  it("still reports a complete pull as a clean success", async () => {
    fetchMock.mockResolvedValue({
      fetched: 42,
      created: 40,
      updated: 2,
      skipped: 0,
      duplicates: 0,
      unmappable: 0,
      errors: [],
      truncated: false,
      readiness: { total: 42, withDateOfBirth: 42, withPostalAddress: 42, sendable: 42 },
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const summary = await screen.findByText(/Imported 40 new/);
    expect(summary.className).toContain("success");
    expect(summary).not.toHaveTextContent(/partial/i);
    expect(screen.queryByText(/partial: some contacts/i)).not.toBeInTheDocument();
  });
});
