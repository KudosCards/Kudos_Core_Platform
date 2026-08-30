import { clearDraft, draftKey, readDraft, writeDraft, type DesignDraft } from "./design-draft";
import type { DesignDocument } from "@kudos/shared-types";

const DOCUMENT = { pages: [{ name: "front", elements: [] }] } as unknown as DesignDocument;
const DRAFT: DesignDraft = { name: "Nine years", document: DOCUMENT, ts: 1_700_000_000_000 };

/** Swap window.localStorage for a stub, including ones that throw the way a
 * quota-full or storage-blocked browser does. */
function useStorage(stub: Partial<Storage>) {
  Object.defineProperty(window, "localStorage", {
    value: stub as Storage,
    configurable: true,
    writable: true,
  });
}

describe("design draft backup", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports success when the write actually lands", () => {
    const store = new Map<string, string>();
    useStorage({
      setItem: (k: string, v: string) => void store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => void store.delete(k),
    });

    expect(writeDraft("design-1", DRAFT)).toBe(true);
    expect(store.get(draftKey("design-1"))).toContain("Nine years");
  });

  /**
   * The one that matters. The editor drops both leave-guards and tells the
   * member "backed up on this device" on the strength of this return value. A
   * write that threw and reported success is how work gets lost after being
   * called safe.
   */
  it("reports failure when the browser refuses the write", () => {
    useStorage({
      setItem: () => {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      },
    });

    expect(writeDraft("design-1", DRAFT)).toBe(false);
  });

  it("reports failure when storage is blocked outright", () => {
    // Private mode / blocked site data: touching the property itself throws.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });

    expect(writeDraft("design-1", DRAFT)).toBe(false);
  });

  it("still never throws, whatever storage does", () => {
    useStorage({
      setItem: () => {
        throw new Error("nope");
      },
      getItem: () => {
        throw new Error("nope");
      },
      removeItem: () => {
        throw new Error("nope");
      },
    });

    expect(() => writeDraft("d", DRAFT)).not.toThrow();
    expect(() => clearDraft("d")).not.toThrow();
    expect(readDraft("d")).toBeNull();
  });

  it("returns null for a corrupt or foreign draft rather than throwing", () => {
    const store = new Map<string, string>([[draftKey("d"), "{not json"]]);
    useStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(readDraft("d")).toBeNull();
  });
});
