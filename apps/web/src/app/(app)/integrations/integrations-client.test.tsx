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
      />,
    );
  }

  beforeEach(() => fetchMock.mockReset());

  it("warns that contacts were left behind when the pull was truncated", async () => {
    fetchMock.mockResolvedValue({
      fetched: 5000,
      created: 4800,
      updated: 100,
      skipped: 100,
      errors: [],
      truncated: true,
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

  it("still reports a complete pull as a clean success", async () => {
    fetchMock.mockResolvedValue({
      fetched: 42,
      created: 40,
      updated: 2,
      skipped: 0,
      errors: [],
      truncated: false,
    });
    renderClient();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const summary = await screen.findByText(/Imported 40 new/);
    expect(summary.className).toContain("success");
    expect(summary).not.toHaveTextContent(/partial/i);
    expect(screen.queryByText(/partial: some contacts/i)).not.toBeInTheDocument();
  });
});
