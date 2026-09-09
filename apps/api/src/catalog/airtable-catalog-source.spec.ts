import { AirtableCatalogSource } from "./airtable-catalog-source";
import { CATALOG_FETCH_BUDGET_MS } from "../common/fetch-budget";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function recordNamed(id: string) {
  return {
    id,
    fields: {
      "Card Title": "Happy Birthday - Balloons",
      "Card SKU": "KC-BDAY-GEN-002",
      Occasion: "Birthday",
      Status: "Active",
      "Front Image": [{ url: "https://airtable.test/a.png", filename: "a.png", type: "image/png" }],
    },
  };
}

describe("AirtableCatalogSource", () => {
  const config = { apiKey: "pat_test", baseId: "appTest", tableName: "Card List" };
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("gives up on a pull that outruns its wall-clock budget, rather than returning part of it", async () => {
    // Each page bounded, the sum unbounded: 100 pages x 4 attempts x a 15s
    // deadline, plus backoffs capped at 30s, is over four hours — and
    // `POST /catalog/sync` is a synchronous request an operator waits on.
    //
    // It has to *throw*. `deactivateRetired` deactivates every card absent from
    // the fetched set, guarded only against a fetch of exactly zero, so
    // returning a partial pull would quietly unpublish whatever came after the
    // cut-off. Failing is the safe half of the fork. See ADR 0238.
    let page = 0;
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(() => {
      page += 1;
      // Always another page, so nothing but the budget can end this.
      return Promise.resolve(
        jsonResponse({ records: [recordNamed(`rec${page}`)], offset: `off${page}` }),
      );
    });

    // A clock that jumps past the budget once the first page is paid for.
    let calls = 0;
    const now = () => (calls++ === 0 ? 0 : CATALOG_FETCH_BUDGET_MS);

    await expect(new AirtableCatalogSource(config, now).fetchActiveCards()).rejects.toThrow(
      /budget/i,
    );
    // Stopped between pages, not after a hundred of them.
    expect(page).toBeLessThan(5);
  });

  it("isConfigured reflects whether credentials are present", () => {
    expect(new AirtableCatalogSource(config).isConfigured()).toBe(true);
    expect(new AirtableCatalogSource({ ...config, apiKey: undefined }).isConfigured()).toBe(false);
  });

  it("normalises records: lowercased category, first attachment, Blank inside message dropped", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        records: [
          {
            id: "rec1",
            fields: {
              "Card Title": "Happy Birthday - Balloons",
              "Card SKU": "KC-BDAY-GEN-002",
              Occasion: "Birthday",
              Status: "Active",
              "Inside Message": "Blank",
              "Front Image": [
                { url: "https://airtable.test/a.png", filename: "a.png", type: "image/png" },
              ],
            },
          },
        ],
      }),
    );

    const cards = await new AirtableCatalogSource(config).fetchActiveCards();
    expect(cards).toEqual([
      {
        externalId: "rec1",
        sku: "KC-BDAY-GEN-002",
        title: "Happy Birthday - Balloons",
        category: "birthday",
        frontImage: {
          url: "https://airtable.test/a.png",
          filename: "a.png",
          contentType: "image/png",
        },
        insideMessage: null,
      },
    ]);
  });

  it("skips records not marked Active and those without a title", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        records: [
          { id: "rec1", fields: { "Card Title": "Live", Status: "Active" } },
          { id: "rec2", fields: { "Card Title": "Draft", Status: "Draft" } },
          { id: "rec3", fields: { Status: "Active" } },
        ],
      }),
    );

    const cards = await new AirtableCatalogSource(config).fetchActiveCards();
    expect(cards.map((c) => c.externalId)).toEqual(["rec1"]);
  });

  it("follows Airtable pagination via offset", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          records: [{ id: "rec1", fields: { "Card Title": "One" } }],
          offset: "next",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ records: [{ id: "rec2", fields: { "Card Title": "Two" } }] }),
      );

    const cards = await new AirtableCatalogSource(config).fetchActiveCards();
    expect(cards.map((c) => c.externalId)).toEqual(["rec1", "rec2"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error on a non-OK Airtable response", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorised"),
    } as unknown as Response);

    await expect(new AirtableCatalogSource(config).fetchActiveCards()).rejects.toThrow(
      /401.*token is invalid/,
    );
  });

  it("waits and tries again when Airtable rate-limits, instead of failing the sync", async () => {
    // The whole nightly catalog sync hangs off this one read, and the operator
    // hint for a 429 has always been "wait a moment and try again". Now the code
    // does that rather than asking a person to. See ADR 0209.
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => null },
        text: () => Promise.resolve("rate limited"),
      } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ records: [] }));

    await expect(new AirtableCatalogSource(config).fetchActiveCards()).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after a bounded number of attempts rather than retrying all night", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve("upstream down"),
    } as unknown as Response);

    await expect(new AirtableCatalogSource(config).fetchActiveCards()).rejects.toThrow(/503/);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("on a 403 lists the base's real tables (via schema) so the operator can fix the table name", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      // 1) records fetch is forbidden / table-not-found
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('{"error":{"type":"INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND"}}'),
      } as unknown as Response)
      // 2) schema fetch succeeds and returns the real tables
      .mockResolvedValueOnce(
        jsonResponse({
          tables: [
            { id: "tblAAA", name: "Cards" },
            { id: "tblBBB", name: "Recipients" },
          ],
        }),
      );

    await expect(new AirtableCatalogSource(config).fetchActiveCards()).rejects.toThrow(
      /tables are: "Cards" \(tblAAA\), "Recipients" \(tblBBB\)/,
    );
  });

  describe("field mapping", () => {
    /** One Airtable record with whatever columns a test wants. */
    function recordWith(fields: Record<string, unknown>) {
      return {
        records: [
          {
            id: "rec1",
            fields: {
              Status: "Active",
              "Front Image": [{ url: "https://airtable.test/a.png", type: "image/png" }],
              ...fields,
            },
          },
        ],
      };
    }

    it("reports which column each field was read from", async () => {
      fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(
          jsonResponse(recordWith({ "Card Title": "GCSE Golden", Occasion: "Congratulations" })),
        );

      const source = new AirtableCatalogSource(config);
      await source.fetchActiveCards();

      const mapping = source.lastFieldMapping();
      expect(mapping?.fields.title?.using).toBe("Card Title");
      expect(mapping?.fields.category?.using).toBe("Occasion");
      expect(mapping?.columns).toContain("Card Title");
    });

    it("flags a second populated alias — the silent cause of a sync that seems to do nothing", async () => {
      // A table carrying both columns reads "Card Title" and ignores "Name".
      // Somebody editing "Name" sees no change and no error; this is what makes
      // that visible.
      fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(
          jsonResponse(recordWith({ "Card Title": "GSCEE Golden", Name: "GCSE Golden" })),
        );

      const source = new AirtableCatalogSource(config);
      const cards = await source.fetchActiveCards();

      expect(cards[0]?.title).toBe("GSCEE Golden");
      const title = source.lastFieldMapping()?.fields.title;
      expect(title?.using).toBe("Card Title");
      expect(title?.alsoPresent).toEqual(["Name"]);
    });

    it("falls through to the next alias when the preferred column is empty", async () => {
      fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(jsonResponse(recordWith({ "Card Title": "", Name: "GCSE Golden" })));

      const source = new AirtableCatalogSource(config);
      const cards = await source.fetchActiveCards();

      expect(cards[0]?.title).toBe("GCSE Golden");
      const title = source.lastFieldMapping()?.fields.title;
      expect(title?.using).toBe("Name");
      expect(title?.alsoPresent).toEqual([]);
    });

    it("reports no column for a field the table doesn't have", async () => {
      fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(jsonResponse(recordWith({ "Card Title": "GCSE Golden" })));

      const source = new AirtableCatalogSource(config);
      await source.fetchActiveCards();

      expect(source.lastFieldMapping()?.fields.sku?.using).toBeNull();
    });

    it("is null before anything has been fetched", () => {
      expect(new AirtableCatalogSource(config).lastFieldMapping()).toBeNull();
    });
  });
});
