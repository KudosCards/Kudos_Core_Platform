/**
 * The catalog's upstream source of card products. Kept behind an interface (and
 * an injectable token) so the Airtable implementation can be swapped for a mock
 * in tests — exactly the pattern STRIPE_CLIENT / JWKS_RESOLVER already use —
 * since this build/test environment has no network path to Airtable.
 */
export const CATALOG_SOURCE = Symbol("CATALOG_SOURCE");

/** One artwork attachment as it matters to us: a fetchable URL plus enough to
 * name/type the copy we store. Airtable's own attachment URLs expire after a
 * couple of hours, so the sync copies the bytes into our storage — see
 * catalog-sync.service.ts. */
export interface CatalogImage {
  url: string;
  filename: string | null;
  contentType: string | null;
}

/** A single card product, normalised out of one Airtable record. */
export interface CatalogCardRecord {
  /** Airtable record id (e.g. "rec…") — the immutable key the sync upserts on. */
  externalId: string;
  /** Human-facing product code, e.g. "KC-BDAY-GEN-001". */
  sku: string | null;
  /** Display name, e.g. "Happy Birthday - Balloons". */
  title: string;
  /** Occasion/category, e.g. "birthday". Normalised to lowercase by the source. */
  category: string;
  frontImage: CatalogImage | null;
  insideMessage: string | null;
}

export interface CatalogSource {
  /** False when the required credentials aren't configured, so callers can
   * return a clean "not configured" instead of a cryptic auth failure. */
  isConfigured(): boolean;
  /** Every card the source considers live (Airtable Status = "Active"). */
  fetchActiveCards(): Promise<CatalogCardRecord[]>;
}
