import { HttpRoyalMailClient, normaliseTrackingStatus } from "./royal-mail-client";

/** A minimal Response stand-in for the global fetch mock, matching how the
 * client reads tracking responses (json(), plus text() on the error path). */
function fakeResponse(init: { ok: boolean; status: number; json?: unknown; text?: string }) {
  const body = init.text ?? (init.json !== undefined ? JSON.stringify(init.json) : "");
  return {
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(init.json ?? {}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("normaliseTrackingStatus", () => {
  it("maps any delivery phrasing to delivered", () => {
    for (const s of ["Delivered", "DELIVERED", "Item delivered", "Delivered to safe place"]) {
      expect(normaliseTrackingStatus(s)).toBe("delivered");
    }
  });

  it("treats other carrier states as in transit", () => {
    for (const s of ["In transit", "Accepted at Post Office", "Out for delivery"]) {
      expect(normaliseTrackingStatus(s)).toBe("in_transit");
    }
  });

  it("treats an empty/absent status as unknown", () => {
    expect(normaliseTrackingStatus(null)).toBe("unknown");
    expect(normaliseTrackingStatus(undefined)).toBe("unknown");
    expect(normaliseTrackingStatus("")).toBe("unknown");
  });
});

describe("HttpRoyalMailClient.getTrackingStatus", () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => fetchSpy?.mockRestore());

  function lastUrl(): string {
    const call = fetchSpy.mock.calls.at(-1) as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    return call[0];
  }

  it("reports delivered with the carrier's delivery time, hitting the tracking resource", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: { status: "Delivered", deliveredOn: "2026-08-05T09:14:00.000Z" },
      }),
    );
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    const result = await client.getTrackingStatus("RM123 GB");

    expect(result.status).toBe("delivered");
    expect(result.deliveredAt?.toISOString()).toBe("2026-08-05T09:14:00.000Z");
    // Tracking number is path-encoded onto the tracking resource under the same base.
    expect(lastUrl()).toBe(
      "https://api.parcel.royalmail.com/api/v4/shipments/RM123%20GB/tracking",
    );
  });

  it("reads the latest event when there's no top-level summary", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: {
          events: [
            { description: "Accepted", dateTime: "2026-08-03T10:00:00.000Z" },
            { description: "Delivered", dateTime: "2026-08-05T11:00:00.000Z" },
          ],
        },
      }),
    );
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    const result = await client.getTrackingStatus("RM999GB");

    expect(result.status).toBe("delivered");
    expect(result.deliveredAt?.toISOString()).toBe("2026-08-05T11:00:00.000Z");
  });

  it("returns in_transit (no deliveredAt) while the item is on its way", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: true, status: 200, json: { status: "In transit" } }));
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    const result = await client.getTrackingStatus("RM999GB");

    expect(result.status).toBe("in_transit");
    expect(result.deliveredAt).toBeNull();
  });

  it("treats a 404 (not yet tracked) as unknown, not an error", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: false, status: 404, text: "not found" }));
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    const result = await client.getTrackingStatus("RM000GB");

    expect(result).toEqual({ status: "unknown", deliveredAt: null, rawStatus: null });
  });

  it("throws on a real HTTP failure so the operator sees it", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: false, status: 500, text: "boom" }));
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    await expect(client.getTrackingStatus("RM000GB")).rejects.toThrow(/500/);
  });
});
