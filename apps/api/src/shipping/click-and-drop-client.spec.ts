import {
  HttpClickAndDropClient,
  NoopClickAndDropClient,
  type ClickAndDropClient,
  type ClickAndDropOrderInput,
} from "./click-and-drop-client";

/** The live Click & Drop host, as the provider configures it. */
const BASE = "https://api.parcel.royalmail.com";

const ORDER: ClickAndDropOrderInput = {
  orderReference: "ORD-1-abcd1234",
  recipientName: "Ada Lovelace",
  addressLine1: "1 Test Street",
  addressLine2: null,
  city: "London",
  postcode: "SW1A 1AA",
  country: "GB",
  postageClass: "first_class",
  orderDate: "2026-01-01T00:00:00.000Z",
  subtotalPence: 350,
};

/** A minimal Response stand-in for the global fetch mock. The client reads the
 * body via `text()` (then parses), so when a test supplies `json` we serialise it
 * as the body text — exactly what a real Response does. */
function fakeResponse(init: { ok: boolean; status: number; json?: unknown; text?: string }) {
  const body = init.text ?? (init.json !== undefined ? JSON.stringify(init.json) : "");
  return {
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(init.json ?? {}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("HttpClickAndDropClient", () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  function lastCall(): { url: string; init: RequestInit } {
    const call = fetchSpy.mock.calls.at(-1) as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    return { url: call[0], init: call[1] };
  }

  function authOf(init: RequestInit): string | undefined {
    return (init.headers as Record<string, string>).Authorization;
  }

  it("sends the raw API key in Authorization by default and posts to /api/v1/orders", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: { createdOrders: [{ orderIdentifier: 987 }] },
      }),
    );
    const client = new HttpClickAndDropClient("secret-key", "https://api.parcel.royalmail.com");

    const result = await client.createOrder(ORDER);

    expect(result.orderIdentifier).toBe("987");
    const { url, init } = lastCall();
    expect(url).toBe("https://api.parcel.royalmail.com/api/v1/orders");
    expect(init.method).toBe("POST");
    expect(authOf(init)).toBe("secret-key");
  });

  it("includes the required shippingCostCharged and a consistent total in the order line", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        fakeResponse({ ok: true, status: 200, json: { createdOrders: [{ orderIdentifier: 1 }] } }),
      );
    const client = new HttpClickAndDropClient("secret-key", "https://api.parcel.royalmail.com");

    await client.createOrder(ORDER); // subtotalPence: 350 → £3.50

    const item = (JSON.parse((lastCall().init.body as string) ?? "{}") as { items: unknown[] })
      .items[0] as { subtotal: number; shippingCostCharged: number; total: number };
    // Postage is included in the flat price, so shipping is 0 and total === subtotal.
    // Omitting shippingCostCharged makes Click & Drop reject the whole order.
    expect(item.shippingCostCharged).toBe(0);
    expect(item.subtotal).toBe(3.5);
    expect(item.total).toBe(3.5);
  });

  it("prefixes Bearer when the auth scheme is 'bearer'", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        fakeResponse({ ok: true, status: 200, json: { createdOrders: [{ orderIdentifier: 1 }] } }),
      );
    const client = new HttpClickAndDropClient(
      "secret-key",
      "https://api.parcel.royalmail.com",
      {},
      "bearer",
    );

    await client.createOrder(ORDER);

    expect(authOf(lastCall().init)).toBe("Bearer secret-key");
  });

  it("includes the endpoint + status in the error on a non-2xx create", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: false, status: 401, text: "Unauthorized" }));
    const client = new HttpClickAndDropClient("bad-key", "https://api.parcel.royalmail.com");

    await expect(client.createOrder(ORDER)).rejects.toThrow(
      /POST https:\/\/api\.parcel\.royalmail\.com\/api\/v1\/orders \(401\): Unauthorized/,
    );
  });

  it("surfaces a rejected failedOrders response", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: { failedOrders: [{ errors: [{ message: "duplicate order reference" }] }] },
      }),
    );
    const client = new HttpClickAndDropClient("secret-key", "https://api.parcel.royalmail.com");

    await expect(client.createOrder(ORDER)).rejects.toThrow(/duplicate order reference/);
  });

  it("reads Royal Mail's errorCode/errorMessage fields (the real rejection shape)", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: {
          failedOrders: [
            {
              orderReference: ORDER.orderReference,
              errors: [{ errorCode: "1001", errorMessage: "Postcode is not valid" }],
            },
          ],
        },
      }),
    );
    const client = new HttpClickAndDropClient("secret-key", "https://api.parcel.royalmail.com");

    // The message and the code both surface — no more "unknown error".
    await expect(client.createOrder(ORDER)).rejects.toThrow(/Postcode is not valid \(1001\)/);
  });

  it("falls back to the raw rejection JSON when no known field is present", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: { failedOrders: [{ somethingNew: "unexpected shape" }] },
      }),
    );
    const client = new HttpClickAndDropClient("secret-key", "https://api.parcel.royalmail.com");

    // Even an unrecognised shape surfaces its raw content rather than "unknown error".
    await expect(client.createOrder(ORDER)).rejects.toThrow(/unexpected shape/);
  });

  it("surfaces the raw body when failedOrders[0] is empty and the reason is top-level", async () => {
    // The exact shape that produced a bare "unknown error" in production: an empty
    // failed-order line, with the real reason sitting on the envelope.
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        json: { message: "Invalid postcode for the destination country", failedOrders: [{}] },
      }),
    );
    const client = new HttpClickAndDropClient("secret-key", "https://api.parcel.royalmail.com");

    await expect(client.createOrder(ORDER)).rejects.toThrow(
      /Invalid postcode for the destination country/,
    );
  });

  it("surfaces the raw body when a 200 has neither created nor failed orders", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        fakeResponse({ ok: true, status: 200, text: '{"errorsCount":1,"successCount":0}' }),
      );
    const client = new HttpClickAndDropClient("secret-key", "https://api.parcel.royalmail.com");

    // No createdOrders → a rejection, and the raw envelope is the clue.
    await expect(client.createOrder(ORDER)).rejects.toThrow(/errorsCount/);
  });

  it("probe() does a read-only GET and reports status + body + endpoint + scheme", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeResponse({ ok: false, status: 401, text: "invalid api key" }));
    const client = new HttpClickAndDropClient("bad-key", "https://api.parcel.royalmail.com");

    const probe = await client.probe();

    const { url, init } = lastCall();
    expect(init.method).toBe("GET");
    expect(url).toBe("https://api.parcel.royalmail.com/api/v1/orders");
    expect(probe).toEqual({
      ok: false,
      status: 401,
      body: "invalid api key",
      endpoint: "https://api.parcel.royalmail.com/api/v1/orders",
      authScheme: "raw",
    });
  });

  it("probe() captures a network error without throwing", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND"));
    const client = new HttpClickAndDropClient("k", "https://api.parcel.royalmail.com");

    const probe = await client.probe();

    expect(probe.ok).toBe(false);
    expect(probe.status).toBe(0);
    expect(probe.error).toBe("ENOTFOUND");
  });

  /**
   * Deleting a refunded card from the Click & Drop queue. The governing rule is
   * that this never throws and never over-reports success: an identifier counts
   * as cancelled only when Royal Mail names it as deleted, because a card wrongly
   * assumed pulled is a card that gets posted after the customer was refunded.
   */
  describe("cancelOrders", () => {
    it("DELETEs the identifiers as one comma-separated path segment", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          fakeResponse({ ok: true, status: 200, json: { deletedOrders: [1, 2] } }),
        );

      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders(["1", "2"]);

      const { url, init } = lastCall();
      expect(init.method).toBe("DELETE");
      expect(url).toBe(`${BASE}/api/v1/orders/1,2`);
      expect(result).toEqual({ cancelled: ["1", "2"], failed: [] });
    });

    it("reports an identifier Royal Mail refused, with its reason", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        fakeResponse({
          ok: true,
          status: 200,
          json: {
            deletedOrders: [1],
            errors: [{ orderIdentifier: 2, message: "Order has already been despatched" }],
          },
        }),
      );

      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders(["1", "2"]);

      expect(result.cancelled).toEqual(["1"]);
      expect(result.failed).toEqual([
        { orderIdentifier: "2", reason: "Order has already been despatched" },
      ]);
    });

    it("treats an identifier the response never mentions as still live", async () => {
      // The fail-safe direction: silence is not confirmation. An operator being
      // told to check a card that was in fact deleted is a wasted minute; the
      // other way round is a refunded card landing on a doormat.
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(fakeResponse({ ok: true, status: 200, json: { deletedOrders: [1] } }));

      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders(["1", "2"]);

      expect(result.cancelled).toEqual(["1"]);
      expect(result.failed).toEqual([
        { orderIdentifier: "2", reason: expect.stringContaining("did not confirm") },
      ]);
    });

    it("fails every identifier in a batch on a non-2xx, without throwing", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(fakeResponse({ ok: false, status: 503, text: "upstream down" }));

      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders(["1", "2"]);

      expect(result.cancelled).toEqual([]);
      expect(result.failed.map((f) => f.orderIdentifier)).toEqual(["1", "2"]);
      expect(result.failed[0]!.reason).toContain("503");
      expect(result.failed[0]!.reason).toContain("upstream down");
    });

    it("fails every identifier in a batch when the request never completes", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND"));

      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders(["1"]);

      expect(result).toEqual({
        cancelled: [],
        failed: [{ orderIdentifier: "1", reason: "ENOTFOUND" }],
      });
    });

    it("fails every identifier when the response body is unreadable", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(fakeResponse({ ok: true, status: 200, text: "<html>oops</html>" }));

      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders(["1"]);

      expect(result.cancelled).toEqual([]);
      expect(result.failed[0]!.reason).toContain("unreadable");
    });

    it("splits a large cancellation into batches so the URL stays sane", async () => {
      // A refunded 120-card order must not become one 120-identifier URL.
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: string | URL | Request) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const ids = url.split("/orders/")[1]!.split(",");
          return Promise.resolve(
            fakeResponse({ ok: true, status: 200, json: { deletedOrders: ids } }),
          );
        });

      const identifiers = Array.from({ length: 120 }, (_, i) => String(i + 1));
      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders(identifiers);

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.cancelled).toEqual(identifiers);
      expect(result.failed).toEqual([]);
    });

    it("makes no request at all for an empty list", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch");
      const result = await new HttpClickAndDropClient("key", BASE).cancelOrders([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ cancelled: [], failed: [] });
    });
  });
});

describe("NoopClickAndDropClient", () => {
  it("is disabled and its probe reports not-configured without a call", async () => {
    const client = new NoopClickAndDropClient();
    expect(client.enabled).toBe(false);
    const probe = await client.probe();
    expect(probe).toMatchObject({ ok: false, status: 0, endpoint: "" });
    expect(probe.body).toMatch(/not configured/i);
  });

  it("resolves cancelOrders rather than rejecting, so a refund can't fail on it", async () => {
    // Through the interface, the way the service consumes it.
    const client: ClickAndDropClient = new NoopClickAndDropClient();
    await expect(client.cancelOrders(["1"])).resolves.toEqual({ cancelled: [], failed: [] });
  });
});
