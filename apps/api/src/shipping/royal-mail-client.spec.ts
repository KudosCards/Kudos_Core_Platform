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
    expect(lastUrl()).toBe("https://api.parcel.royalmail.com/api/v4/shipments/RM123%20GB/tracking");
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

  it("retries a rate-limited tracking read rather than losing the update", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, text: "slow down" }))
      .mockResolvedValueOnce(
        fakeResponse({ ok: true, status: 200, json: { status: "Delivered" } }),
      );
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    const result = await client.getTrackingStatus("RM123GB");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("delivered");
  });

  it("throws on a real HTTP failure so the operator sees it", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: false, status: 500, text: "boom" }));
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    await expect(client.getTrackingStatus("RM000GB")).rejects.toThrow(/500/);
  });
});

/**
 * Booking a shipment is not safe to repeat: Royal Mail may have created it and
 * failed to answer, and a retry would book a second one — a second card in the
 * post at our cost. Reads retry; this create does not. See ADR 0209.
 */
describe("HttpRoyalMailClient.createShipment", () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => fetchSpy?.mockRestore());

  const input = {
    orderReference: "ORD-1",
    recipientName: "Ada Lovelace",
    addressLine1: "1 Test Street",
    addressLine2: null,
    city: "London",
    postcode: "SW1A 1AA",
    country: "GB",
    postageClass: "first_class" as const,
  };

  it("makes exactly one attempt on a 503, and surfaces the failure", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: false, status: 503, text: "upstream down" }));
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    await expect(client.createShipment(input)).rejects.toThrow(/503/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("gives the booking a deadline", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: true, status: 200, json: { trackingNumber: "RM1" } }));
    const client = new HttpRoyalMailClient("secret-key", "https://api.parcel.royalmail.com");

    await client.createShipment(input);

    const call = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });
});
