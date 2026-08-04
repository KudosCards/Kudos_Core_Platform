import { PLAN_CATALOG, planDisplayName, type BatchOrderStatus } from "@kudos/shared-types";

/** Plan labels shown in the admin. Sourced from the shared PLAN_CATALOG so the
 * ops views name plans exactly as the customer-facing site does (Free / Pro /
 * Centre) — one source of truth, no drift. */
export const PLAN_LABELS: Record<string, string> = Object.fromEntries(
  PLAN_CATALOG.map((plan) => [plan.id, plan.name]),
);

export function planLabel(planId: string): string {
  return planDisplayName(planId);
}

export type AccountHealth = "active" | "at_risk" | "churned" | "none";

export const HEALTH_LABELS: Record<Exclude<AccountHealth, "none">, string> = {
  active: "Active",
  at_risk: "At-risk",
  churned: "Churned",
};

/** Pill classes (bg + text/border) per health state. */
export const HEALTH_CLASSES: Record<Exclude<AccountHealth, "none">, string> = {
  active: "bg-[#e8f1ea] text-[#2f7d54]",
  at_risk: "border border-accent/40 text-accent",
  churned: "bg-foreground/[0.07] text-muted",
};

/** The physical progress of an order, derived from its lifecycle status — the
 * "Fulfillment" column, distinct from the order Status column. */
export function fulfillmentLabel(status: BatchOrderStatus): string {
  switch (status) {
    case "completed":
      return "Delivered";
    case "fulfilling":
      return "In progress";
    case "paid":
      return "Pending";
    default:
      return "—";
  }
}

/** ORD-1035 from a raw order number. */
export function formatOrderNumber(orderNumber: number): string {
  return `ORD-${orderNumber}`;
}
