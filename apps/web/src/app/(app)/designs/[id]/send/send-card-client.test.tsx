import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SendCardClient } from "./send-card-client";
import type { DesignDocument } from "@kudos/shared-types";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

/**
 * The contact typeahead debounces, but a debounce only delays the request — it
 * does nothing about the one already in flight. Type "ab", then "abc": if the
 * "ab" response is slower it lands second and repopulates the dropdown with
 * results for a query the sender has already moved past. See ADR 0201.
 */
describe("SendCardClient — the contact typeahead", () => {
  const DOCUMENT = { pages: [{ name: "front", elements: [] }] } as unknown as DesignDocument;

  const contact = (name: string) => ({
    id: `c-${name}`,
    firstName: name,
    lastName: "Person",
    addressLine1: "1 Test Street",
    addressLine2: null,
    addressCity: "London",
    addressPostcode: "SW1A 1AA",
  });

  beforeEach(() => fetchMock.mockReset());

  it("ignores a slow response for a query the sender has moved past", async () => {
    let releaseFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      const search = new URL(`http://x${String(url)}`).searchParams.get("search");
      if (search === "ab") return first;
      if (search === "abc") return Promise.resolve({ items: [contact("Newer")] });
      return Promise.resolve({ items: [] });
    });

    render(
      <SendCardClient
        designId="d-1"
        designName="Happy Birthday"
        designDocument={DOCUMENT}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );

    const box = screen.getByRole("textbox", { name: "Find a contact" });
    await userEvent.type(box, "ab");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("search=ab&"))).toBe(true),
    );
    await userEvent.type(box, "c");
    // The result is a button whose accessible name joins the name and address,
    // so an exact-text query would not match the split nodes.
    const option = (name: string) => screen.queryAllByRole("button", { name: new RegExp(name) });
    await waitFor(() => expect(option("Newer Person")).toHaveLength(1), { timeout: 3000 });

    // "ab" finally answers, for a query two keystrokes out of date.
    await act(async () => {
      releaseFirst({ items: [contact("Stale")] });
      await first;
    });

    expect(option("Stale Person")).toHaveLength(0);
    expect(option("Newer Person")).toHaveLength(1);
  });
});
