import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecipientDetailClient } from "./recipient-detail-client";
import type { Recipient } from "@kudos/shared-types";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

/**
 * A contact imported with a US-order date mix-up. The user clears the date of
 * birth and saves. The form closed with no error, the header still read the old
 * date, and — because a date of birth is what schedules a birthday card — the
 * wrong-dated card kept being generated, paid from the wallet on an auto-send
 * account.
 *
 * The blank field was simply omitted from the PATCH, which a merge treats as
 * "leave it alone". The address fields four lines below already did the
 * opposite. See ADR 0200.
 */
describe("RecipientDetailClient — clearing a field", () => {
  const recipient = {
    id: "r-1",
    firstName: "Wrongly",
    lastName: "Dated",
    dateOfBirth: new Date("2015-12-25"),
    email: "wrong@example.com",
    addressLine1: "1 Test Street",
    addressLine2: null,
    addressCity: "London",
    addressPostcode: "SW1A 1AA",
    status: "active",
    source: "manual",
    customFields: null,
  } as unknown as Recipient;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ...recipient, dateOfBirth: null, email: null });
  });

  async function setup() {
    render(
      <RecipientDetailClient
        recipient={recipient}
        initialEvents={[]}
        initialReturnCases={[]}
        initialKeyDates={[]}
      />,
    );
    // The form lives behind "Edit details".
    await userEvent.click(screen.getByRole("button", { name: "Edit details" }));
  }

  const savedBody = () => {
    const patch = fetchMock.mock.calls.find(
      ([, init]) => (init as { method?: string } | undefined)?.method === "PATCH",
    );
    return JSON.parse((patch![1] as { body: string }).body) as Record<string, unknown>;
  };

  it("sends null for a cleared date of birth, not nothing at all", async () => {
    await setup();
    await userEvent.clear(screen.getByLabelText("Date of birth"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody()).toHaveProperty("dateOfBirth", null);
  });

  it("sends null for a cleared email", async () => {
    await setup();
    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody()).toHaveProperty("email", null);
  });

  it("still sends a value that was filled in", async () => {
    await setup();
    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.type(screen.getByLabelText("Email"), "right@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody()).toHaveProperty("email", "right@example.com");
  });
});
