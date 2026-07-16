import { AirtableCatalogSource } from "./airtable-catalog-source";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe("AirtableCatalogSource", () => {
  const config = { apiKey: "pat_test", baseId: "appTest", tableName: "Card List" };
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("isConfigured reflects whether credentials are present", () => {
    expect(new AirtableCatalogSource(config).isConfigured()).toBe(true);
    expect(
      new AirtableCatalogSource({ ...config, apiKey: undefined }).isConfigured(),
    ).toBe(false);
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
        frontImage: { url: "https://airtable.test/a.png", filename: "a.png", contentType: "image/png" },
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
        jsonResponse({ records: [{ id: "rec1", fields: { "Card Title": "One" } }], offset: "next" }),
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
});
