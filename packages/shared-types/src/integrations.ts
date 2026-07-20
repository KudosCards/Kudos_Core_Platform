import { z } from "zod";

/**
 * The normalized contact shape the inbound integrations endpoint accepts —
 * the single "producer" format every source (inbound API, and later CRM
 * adapters) maps to. Deliberately lenient: DOB and address are optional and
 * the postcode is not UK-validated, because CRM data varies and a contact
 * with no birthday is still worth having (it's flagged, not rejected).
 * See docs/adr/0015-crm-integrations.md.
 */
export const externalContactSchema = z.object({
  /** Stable id of this contact in the caller's system — the dedupe key. */
  externalId: z.string().min(1).max(200),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email().max(320).optional(),
  /** ISO date (YYYY-MM-DD) or full ISO timestamp. */
  dateOfBirth: z.string().max(40).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  addressCity: z.string().max(120).optional(),
  addressPostcode: z.string().max(20).optional(),
  addressCountry: z.string().max(60).optional(),
});
export type ExternalContact = z.infer<typeof externalContactSchema>;

/** Body of POST /integrations/contacts. Bounded so one request can't buffer an
 * unbounded number of rows. */
export const ingestContactsInputSchema = z.object({
  contacts: z.array(externalContactSchema).min(1).max(500),
});
export type IngestContactsInput = z.infer<typeof ingestContactsInputSchema>;

/** The result summary the ingest endpoint returns. */
export const ingestResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.object({ externalId: z.string(), reason: z.string() })),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

/** An account API key as shown in the UI — never includes the secret. */
export const accountApiKeySchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  /** A short, non-secret prefix for recognising the key (e.g. "kudos_ab12cd"). */
  prefix: z.string(),
  lastUsedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type AccountApiKey = z.infer<typeof accountApiKeySchema>;

/** The one-time response when a key is created — the only time the full
 * plaintext `key` is ever returned. */
export const createdApiKeySchema = accountApiKeySchema.extend({
  key: z.string(),
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

/** A connection to an external CRM (Brevo, …) — never includes the API key. */
export const crmConnectionSchema = z.object({
  provider: z.string(),
  syncEnabled: z.boolean(),
  lastSyncedAt: z.coerce.date().nullable(),
  lastSyncStatus: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type CrmConnection = z.infer<typeof crmConnectionSchema>;

/** The outcome of a CRM sync — the ingest summary plus how many were fetched. */
export const crmSyncResultSchema = ingestResultSchema.extend({
  fetched: z.number().int().nonnegative(),
});
export type CrmSyncResult = z.infer<typeof crmSyncResultSchema>;
