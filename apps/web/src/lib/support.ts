import type {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from "@kudos/shared-types";

/** The human ticket reference, rendered TKT-1000 (mirrors the API). */
export function ticketRef(ticketNumber: number): string {
  return `TKT-${ticketNumber}`;
}

export const SUPPORT_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  billing: "Billing & payments",
  orders: "Orders & delivery",
  design: "Card design",
  account: "My account",
  other: "Something else",
};

export const SUPPORT_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Customer-facing status labels. `awaiting_customer` reads as "your reply
 * needed" — from the subscriber's point of view the ball is in their court. */
export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Open",
  awaiting_customer: "Awaiting your reply",
  resolved: "Resolved",
  closed: "Closed",
};

/** Ops-facing status labels — same states, phrased for the support team. */
export const SUPPORT_STATUS_LABELS_OPS: Record<SupportTicketStatus, string> = {
  open: "Needs reply",
  awaiting_customer: "Awaiting customer",
  resolved: "Resolved",
  closed: "Closed",
};

/** Tailwind bg+text for a small status pill, composed with pill sizing at the
 * call site (same convention as ORDER_STATUS_CLASSES). */
export const SUPPORT_STATUS_CLASSES: Record<SupportTicketStatus, string> = {
  open: "bg-accent-soft text-accent",
  awaiting_customer: "bg-warning-soft text-warning",
  resolved: "bg-[#e8f1ea] text-[#2f7d54]",
  closed: "bg-foreground/[0.07] text-muted",
};

export const SUPPORT_PRIORITY_CLASSES: Record<SupportTicketPriority, string> = {
  low: "bg-foreground/[0.07] text-muted",
  normal: "bg-foreground/[0.07] text-muted",
  high: "bg-warning-soft text-warning",
  urgent: "bg-accent-soft text-accent",
};

export function formatSupportDate(value: string | Date): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
