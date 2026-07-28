/** Enum value arrays mirrored from schema.prisma / shared-types enums.ts —
 * kept in sync by hand, the project convention (Prisma can't import from TS). */
export const SUPPORT_CATEGORIES = ["billing", "orders", "design", "account", "other"] as const;
export type SupportCategoryValue = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportPriorityValue = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_STATUSES = ["open", "awaiting_customer", "resolved", "closed"] as const;
export type SupportStatusValue = (typeof SUPPORT_STATUSES)[number];
