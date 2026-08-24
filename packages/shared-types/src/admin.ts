import { z } from "zod";
import {
  batchOrderStatusSchema,
  dispatchOptionSchema,
  fulfillmentJobStatusSchema,
  postageClassSchema,
} from "./enums";

/**
 * Platform-operator (super admin) identity & team management. Distinct from a
 * tuition centre's Membership — this is Kudos's own internal staff. See
 * docs/adr/0040-admin-auth.md.
 */

export const platformAdminRoleSchema = z.enum(["super_admin", "ops"]);
export type PlatformAdminRole = z.infer<typeof platformAdminRoleSchema>;

/** The signed-in operator, as returned by GET /admin/me and POST /admin/access. */
export const adminIdentitySchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  role: platformAdminRoleSchema,
});
export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

/** One operator in the team-management list. */
export const adminTeamMemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  role: platformAdminRoleSchema,
  createdAt: z.coerce.date(),
  /** True for the row representing the current viewer. */
  isYou: z.boolean(),
});
export type AdminTeamMember = z.infer<typeof adminTeamMemberSchema>;

/** A pending email allow-list entry (operator not yet signed in). */
export const adminInviteSchema = z.object({
  email: z.string().email(),
  role: platformAdminRoleSchema,
  createdAt: z.coerce.date(),
});
export type AdminInvite = z.infer<typeof adminInviteSchema>;

/** GET /admin/team — operators, pending invites, and the viewer's role. */
export const adminTeamSchema = z.object({
  admins: z.array(adminTeamMemberSchema),
  invites: z.array(adminInviteSchema),
  yourRole: platformAdminRoleSchema,
});
export type AdminTeam = z.infer<typeof adminTeamSchema>;

/** Body for POST /admin/team/invites. */
export const inviteAdminInputSchema = z.object({
  email: z.string().email(),
  role: platformAdminRoleSchema,
});
export type InviteAdminInput = z.infer<typeof inviteAdminInputSchema>;

/** Body for PATCH /admin/team/:userId. */
export const setAdminRoleInputSchema = z.object({
  role: platformAdminRoleSchema,
});
export type SetAdminRoleInput = z.infer<typeof setAdminRoleInputSchema>;

// ---------------------------------------------------------------------------
// Order detail & real fulfilment progress (ops order-level view). See
// docs/adr/0109-ops-order-detail.md.
// ---------------------------------------------------------------------------

/**
 * A count of an order's cards by fulfilment-job status, plus the Click & Drop
 * import tally — the "340 / 2,000 posted" the ops order list and detail render
 * instead of a status label. `total` is the number of fulfilment jobs, which is
 * 0 for an order that hasn't been paid yet (jobs are created at settlement).
 */
export const orderFulfillmentProgressSchema = z.object({
  total: z.number(),
  pending: z.number(),
  inProgress: z.number(),
  printed: z.number(),
  posted: z.number(),
  delivered: z.number(),
  returnedToSender: z.number(),
  failed: z.number(),
  /** Cards imported into the Royal Mail Click & Drop queue. */
  imported: z.number(),
  /** Cards whose last Click & Drop import push failed. */
  importErrors: z.number(),
});
export type OrderFulfillmentProgress = z.infer<typeof orderFulfillmentProgressSchema>;

/** One card line on the ops order-detail view. Deliberately name + occasion +
 * postage + status — never the street address (that stays behind the audited
 * fulfilment export, mirroring the queue's data minimisation). */
export const adminOrderLineSchema = z.object({
  orderRecipientId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  recipientName: z.string(),
  designName: z.string(),
  postageClass: postageClassSchema,
  dispatchOption: dispatchOptionSchema,
  occasionType: z.string().nullable(),
  occasionDate: z.coerce.date().nullable(),
  dueDate: z.coerce.date().nullable(),
  jobStatus: fulfillmentJobStatusSchema.nullable(),
  trackingReference: z.string().nullable(),
  /** A printable Royal Mail label URL, when dispatch produced one. */
  labelUrl: z.string().nullable(),
  /** Fulfilment milestone timestamps, for the per-card status trail on the
   * order cockpit. Each null until that step happens. See ADR 0123. */
  printedAt: z.coerce.date().nullable(),
  postedAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  clickAndDropImported: z.boolean(),
  clickAndDropError: z.string().nullable(),
});
export type AdminOrderLine = z.infer<typeof adminOrderLineSchema>;

/** GET /admin/orders/:id — one order worked as a unit: header, real progress,
 * and its card lines. */
export const adminOrderDetailSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.number(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  status: batchOrderStatusSchema,
  currency: z.string(),
  subtotalMinor: z.number(),
  postageMinor: z.number(),
  totalMinor: z.number(),
  paymentMethod: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  receiptPdfUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  cardCount: z.number(),
  progress: orderFulfillmentProgressSchema,
  lines: z.array(adminOrderLineSchema),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;

/**
 * One card's outcome from an occasion re-date, for the operator's report.
 *
 * `from`/`to` are the card's dispatch date before and after. `outcome` is
 * `redated` when it moved, `already-repaired` when it was already on the
 * recipient's own occasion (the repair is safe to run twice), and
 * `no-occasion` when that recipient has no dated occasion to move to — those
 * keep the order's send date and need a human to look at them.
 */
export const occasionRedateCardSchema = z.object({
  recipientName: z.string(),
  from: z.coerce.date().nullable(),
  to: z.coerce.date().nullable(),
  outcome: z.enum(["redated", "already-repaired", "no-occasion"]),
});
export type OccasionRedateCard = z.infer<typeof occasionRedateCardSchema>;

/** What an occasion re-date did to an order — reported card by card, because
 *  "we changed 76 things" is not something anyone can check. */
export const occasionRedateSummarySchema = z.object({
  orderNumber: z.number(),
  accountId: z.string().uuid(),
  cards: z.array(occasionRedateCardSchema),
  redated: z.number(),
  unchanged: z.number(),
});
export type OccasionRedateSummary = z.infer<typeof occasionRedateSummarySchema>;
