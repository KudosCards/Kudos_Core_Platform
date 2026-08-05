import {
  HttpClickAndDropClient,
  NoopClickAndDropClient,
  type ClickAndDropOrderInput,
} from "./click-and-drop-client";

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

/** A minimal Response stand-in for the global fetch mock. */
function fakeResponse(init: { ok: boolean; status: number; json?: unknown; text?: string }) {
  return {
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(init.json ?? {}),
    text: () => Promise.resolve(init.text ?? ""),
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
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
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
});

describe("NoopClickAndDropClient", () => {
  it("is disabled and its probe reports not-configured without a call", async () => {
    const client = new NoopClickAndDropClient();
    expect(client.enabled).toBe(false);
    const probe = await client.probe();
    expect(probe).toMatchObject({ ok: false, status: 0, endpoint: "" });
    expect(probe.body).toMatch(/not configured/i);
  });
});
