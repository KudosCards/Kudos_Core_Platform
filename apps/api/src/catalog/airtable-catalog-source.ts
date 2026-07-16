import { Logger } from "@nestjs/common";
import type { CatalogCardRecord, CatalogImage, CatalogSource } from "./catalog-source";

export interface AirtableConfig {
  apiKey: string | undefined;
  baseId: string | undefined;
  tableName: string;
}

interface AirtableAttachment {
  url?: unknown;
  filename?: unknown;
  type?: unknown;
}

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface AirtableListResponse {
  records?: AirtableRecord[];
  offset?: string;
}

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";
const PAGE_SIZE = 100;
// Airtable rate-limits at 5 req/s per base; a page fetch is well under that,
// but a hard cap on pages stops a misconfiguration from looping forever.
const MAX_PAGES = 100;

/**
 * Field-name aliases per logical field, matched case-insensitively (see
 * pickField). Tolerant on purpose: the exact Airtable column names are managed
 * by the Kudos team, not pinned in code, so a small rename ("Occasion" vs
 * "Category") doesn't silently break the sync.
 */
const FIELD_ALIASES = {
  title: ["Card Title", "Title", "Name", "Card Name"],
  category: ["Occasion", "Category", "Card Category", "Card Type", "Type"],
  sku: ["Card SKU", "SKU", "Code", "Card Code"],
  frontImage: ["Front Image", "Image", "Artwork", "Front", "Front Artwork"],
  insideMessage: ["Inside Message", "Message", "Inside", "Inside Text"],
  status: ["Status", "State"],
} as const;

/** Case-insensitive lookup of the first alias present (and non-empty) in `fields`. */
function pickField(fields: Record<string, unknown>, candidates: readonly string[]): unknown {
  const lowerKeyed = new Map(Object.keys(fields).map((key) => [key.toLowerCase(), key]));
  for (const candidate of candidates) {
    const actualKey = lowerKeyed.get(candidate.toLowerCase());
    if (actualKey === undefined) {
      continue;
    }
    const value = fields[actualKey];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

/** Single-line/single-select/number fields → a trimmed string, else null. */
function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  // A single-select can arrive as { name } depending on cell format; be lenient.
  if (value && typeof value === "object" && "name" in value) {
    return asString(value.name);
  }
  return null;
}

/** First usable attachment out of an Airtable attachment cell, or null. */
function firstImage(value: unknown): CatalogImage | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const raw of value) {
    const item = raw as AirtableAttachment;
    const url = typeof item.url === "string" ? item.url : null;
    if (url) {
      return {
        url,
        filename: typeof item.filename === "string" ? item.filename : null,
        contentType: typeof item.type === "string" ? item.type : null,
      };
    }
  }
  return null;
}

/**
 * Reads the card catalog from Airtable over its REST API. Records are fetched
 * with pagination and filtered to Status = "Active" in code (rather than
 * depending on an exact view name or formula), then normalised via tolerant
 * field matching.
 */
export class AirtableCatalogSource implements CatalogSource {
  private readonly logger = new Logger(AirtableCatalogSource.name);

  constructor(private readonly config: AirtableConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.baseId);
  }

  async fetchActiveCards(): Promise<CatalogCardRecord[]> {
    if (!this.config.apiKey || !this.config.baseId) {
      throw new Error("Airtable is not configured (AIRTABLE_API_KEY / AIRTABLE_BASE_ID)");
    }

    const rawRecords = await this.fetchAllRecords(this.config.apiKey, this.config.baseId);
    const cards: CatalogCardRecord[] = [];

    for (const record of rawRecords) {
      const status = asString(pickField(record.fields, FIELD_ALIASES.status));
      // No status column configured → treat every record as live; otherwise
      // only sync the ones explicitly marked Active.
      if (status !== null && status.toLowerCase() !== "active") {
        continue;
      }

      const title = asString(pickField(record.fields, FIELD_ALIASES.title));
      if (!title) {
        this.logger.warn(`Skipping Airtable record ${record.id}: no title`);
        continue;
      }

      const category = asString(pickField(record.fields, FIELD_ALIASES.category));
      cards.push({
        externalId: record.id,
        sku: asString(pickField(record.fields, FIELD_ALIASES.sku)),
        title,
        category: (category ?? "uncategorised").toLowerCase(),
        frontImage: firstImage(pickField(record.fields, FIELD_ALIASES.frontImage)),
        insideMessage: normaliseInsideMessage(
          asString(pickField(record.fields, FIELD_ALIASES.insideMessage)),
        ),
      });
    }

    return cards;
  }

  private async fetchAllRecords(apiKey: string, baseId: string): Promise<AirtableRecord[]> {
    const table = encodeURIComponent(this.config.tableName);
    const records: AirtableRecord[] = [];
    let offset: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`${AIRTABLE_API_BASE}/${baseId}/${table}`);
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      if (offset) {
        url.searchParams.set("offset", offset);
      }

      const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        // A 403/404 here is almost always a wrong TABLE name (Airtable folds
        // "not found" and "no permission" into one code). If the token can read
        // the base schema, list the real table names so the operator knows
        // exactly what to set AIRTABLE_CARDS_TABLE to — no guessing.
        const available =
          response.status === 403 || response.status === 404
            ? await this.describeTables(apiKey, baseId)
            : "";
        throw new Error(
          `Airtable request failed (${response.status}) — ${hintFor(response.status, this.config.tableName)}.${available} ${body.slice(0, 160)}`,
        );
      }

      const data = (await response.json()) as AirtableListResponse;
      records.push(...(data.records ?? []));
      if (!data.offset) {
        return records;
      }
      offset = data.offset;
    }

    throw new Error(`Airtable pagination exceeded ${MAX_PAGES} pages — aborting`);
  }

  /**
   * Best-effort: uses the schema.bases:read scope to list the base's real table
   * names, so a "table not found" error can name them. Returns "" if the scope
   * is missing or the call fails — never throws, so it can only add detail.
   */
  private async describeTables(apiKey: string, baseId: string): Promise<string> {
    try {
      const response = await fetch(`${AIRTABLE_API_BASE}/meta/bases/${baseId}/tables`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        return "";
      }
      const data = (await response.json()) as { tables?: { id: string; name: string }[] };
      const names = (data.tables ?? []).map((t) => `"${t.name}" (${t.id})`);
      if (names.length === 0) {
        return "";
      }
      return ` The token CAN see this base; its tables are: ${names.join(", ")}. Set AIRTABLE_CARDS_TABLE to one of these (the name or the tbl… id).`;
    } catch {
      return "";
    }
  }
}

/** Turns an Airtable HTTP status into an operator-actionable hint. */
function hintFor(status: number, tableName: string): string {
  switch (status) {
    case 401:
      return "the token is invalid or was regenerated — update AIRTABLE_API_KEY in Railway with the current token";
    case 403:
      return "the token doesn't have access to this base — check its scope and that the base is added to the token";
    case 404:
      return `base or table not found — check AIRTABLE_BASE_ID and that a table named "${tableName}" exists (AIRTABLE_CARDS_TABLE)`;
    case 422:
      return "Airtable rejected the request — check AIRTABLE_CARDS_TABLE matches the table name exactly";
    case 429:
      return "Airtable rate limit hit — wait a moment and try again";
    default:
      return "unexpected Airtable error";
  }
}

/** "Blank" / "-" placeholders in the sheet mean "no inside message", not literal text. */
function normaliseInsideMessage(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const lowered = value.toLowerCase();
  if (lowered === "blank" || lowered === "-" || lowered === "n/a" || lowered === "none") {
    return null;
  }
  return value;
}
