import { z } from "zod";

/**
 * The super-admin "Customer 360" — one account's full profile and engagement,
 * aggregated across every surface the platform has grown (contacts, occasions,
 * integrations, wallet, team, orders, returns). Returned by GET /admin/customers/:id.
 * See docs/adr/0041-admin-customer-360.md.
 */

export const accountHealthSchema = z.enum(["active", "at_risk", "churned", "none"]);
export type AccountHealth = z.infer<typeof accountHealthSchema>;

/** How far a customer has got in actually using the product, independent of billing. */
export const engagementLevelSchema = z.enum(["activated", "onboarding", "dormant"]);
export type EngagementLevel = z.infer<typeof engagementLevelSchema>;

export const customer360Schema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  plan: z.string(),
  contactEmail: z.string().nullable(),
  hasStripeCustomer: z.boolean(),
  reminderEmailsEnabled: z.boolean(),
  createdAt: z.coerce.date(),
  /** Most recent signal across orders, contacts, occasions, sync, API, wallet. */
  lastActivityAt: z.coerce.date(),
  health: accountHealthSchema,

  engagement: z.object({
    level: engagementLevelSchema,
    signals: z.object({
      hasContacts: z.boolean(),
      hasOccasions: z.boolean(),
      hasIntegration: z.boolean(),
      hasOrder: z.boolean(),
      hasTeam: z.boolean(),
    }),
  }),

  subscription: z
    .object({
      status: z.string(),
      plan: z.string(),
      active: z.boolean(),
      currentPeriodEnd: z.coerce.date(),
    })
    .nullable(),

  team: z.object({
    memberCount: z.number(),
    seatLimit: z.number(),
    pendingInvites: z.number(),
    members: z.array(z.object({ email: z.string().nullable(), role: z.string() })),
  }),

  contacts: z.object({
    total: z.number(),
    active: z.number(),
    lapsed: z.number(),
    archived: z.number(),
    needsAddress: z.number(),
    listCount: z.number(),
    bySource: z.array(z.object({ source: z.string(), count: z.number() })),
  }),

  occasions: z.object({
    scheduled: z.number(),
    autoSend: z.number(),
    upcoming: z.array(
      z.object({ label: z.string(), date: z.coerce.date().nullable() }),
    ),
  }),

  integrations: z.object({
    crm: z.array(
      z.object({
        provider: z.string(),
        syncEnabled: z.boolean(),
        lastSyncedAt: z.coerce.date().nullable(),
        lastSyncStatus: z.string().nullable(),
      }),
    ),
    apiKeys: z.array(
      z.object({
        label: z.string(),
        prefix: z.string(),
        lastUsedAt: z.coerce.date().nullable(),
        revoked: z.boolean(),
      }),
    ),
  }),

  wallet: z.object({ balanceMinor: z.number() }),
  designs: z.object({ savedCount: z.number() }),
  messages: z.object({ pageCount: z.number(), totalViews: z.number() }),

  orders: z.object({
    count: z.number(),
    cardsSent: z.number(),
    totalSpentMinor: z.number(),
    byStatus: z.array(z.object({ status: z.string(), count: z.number() })),
    recent: z.array(
      z.object({
        id: z.string(),
        orderNumber: z.number(),
        status: z.string(),
        totalMinor: z.number(),
        currency: z.string(),
        cardCount: z.number(),
        paymentMethod: z.string().nullable(),
        createdAt: z.coerce.date(),
      }),
    ),
  }),

  returns: z.object({ open: z.number(), total: z.number() }),
});
export type Customer360 = z.infer<typeof customer360Schema>;
