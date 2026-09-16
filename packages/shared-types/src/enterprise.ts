import { z } from "zod";
import { enterpriseEnquiryStatusSchema } from "./enums";

/**
 * The Enterprise "Contact us" lead — the contract between the public contact
 * form and the API, plus the ops-facing view. Enterprise isn't a self-serve
 * plan (no Stripe object): a visitor submits an enquiry, ops follow up and set
 * the account up by hand. See docs/adr/0101-enterprise-plan-enquiries.md.
 */

/** What the public /enterprise form submits. Trimmed + length-bounded so a
 * bad/abusive payload is rejected before it reaches the DB or the ops inbox. */
export const createEnterpriseEnquirySchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
  organisation: z.string().trim().min(1, "Please enter your organisation").max(160),
  /** Optional phone — free text (international formats vary). */
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  /** Optional rough size, e.g. "500 students" — free text, not a fixed bucket. */
  teamSize: z.string().trim().max(80).optional().or(z.literal("")),
  message: z.string().trim().min(1, "Tell us a little about what you need").max(4000),
  /**
   * Honeypot. Hidden from real visitors, and named so that no browser or
   * password-manager autofill heuristic goes near it — a bot fills every input
   * it finds. Anything in here means the submission was automated. Optional, so
   * a genuine caller that never sends it is unaffected. See ADR 0244.
   */
  contactReference: z.string().max(200).optional(),
  /**
   * ISO timestamp of when the form was rendered, set client-side at mount.
   * Its *absence* is neutral — anything that isn't our web form won't send it —
   * so only a present, implausibly-recent value counts against a submission.
   */
  formOpenedAt: z.string().datetime().optional(),
});
export type CreateEnterpriseEnquiryInput = z.infer<typeof createEnterpriseEnquirySchema>;

/** One Enterprise enquiry, as the ops portal sees it. */
export const enterpriseEnquirySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  organisation: z.string(),
  phone: z.string().nullable(),
  teamSize: z.string().nullable(),
  message: z.string(),
  status: enterpriseEnquiryStatusSchema,
  /** Which rule caught this, when the status is `spam`; null otherwise. Shown
   * to ops so the filter can be checked rather than trusted. */
  spamReason: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type EnterpriseEnquiry = z.infer<typeof enterpriseEnquirySchema>;

/** The response to a successful public submission — deliberately minimal. */
export const enterpriseEnquiryAckSchema = z.object({
  id: z.string().uuid(),
  status: enterpriseEnquiryStatusSchema,
});
export type EnterpriseEnquiryAck = z.infer<typeof enterpriseEnquiryAckSchema>;
