import type { StandingOrderBlocker } from "@kudos/shared-types";
import { consentIsCurrent } from "./standing-order.consent";

/** The parts of a standing order that decide whether it runs. Structural rather
 * than the Prisma row type, so the pure rule below has no database in it. */
export interface StandingOrderState {
  enabled: boolean;
  consentVersion: number | null;
  audienceKind: "all" | "list" | "segment";
  recipientListId: string | null;
  segmentId: string | null;
  designs: { archived: boolean }[];
  messageCount: number;
}

/**
 * Everything standing between "switched on" and "actually running".
 *
 * One function, called by both the customer-facing view and the approval cron,
 * because two definitions of "running" would drift and the drift would show up
 * as a card that either went when the dashboard said it would not, or did not
 * go when it said it would. See docs/adr/0256 and docs/adr/0257.
 */
export function standingOrderBlockers(
  state: StandingOrderState,
  planAllows: boolean,
): StandingOrderBlocker[] {
  const blockers: StandingOrderBlocker[] = [];
  if (!planAllows) blockers.push("plan");
  if (!consentIsCurrent(state.consentVersion)) blockers.push("consent");
  if (state.designs.length === 0 || state.messageCount === 0) blockers.push("empty_pool");
  // Removing a design from the library archives it (ADR 0158) rather than
  // deleting the row, so the pool entry survives. Left alone, the pool would
  // look full while holding a card we could not send.
  if (state.designs.some((design) => design.archived)) blockers.push("design_archived");
  // The foreign keys are SET NULL, so a deleted list leaves the ids empty while
  // `audienceKind` still remembers what was meant. Without that gap the
  // instruction would quietly widen from one class of thirty children to every
  // contact on the account.
  if (audienceGone(state)) blockers.push("audience_gone");
  if (state.audienceKind === "segment") blockers.push("audience_unsupported");
  return blockers;
}

/** Whether a switched-on instruction with these blockers is running. */
export function standingOrderIsActive(state: StandingOrderState, planAllows: boolean): boolean {
  return state.enabled && standingOrderBlockers(state, planAllows).length === 0;
}

function audienceGone(state: StandingOrderState): boolean {
  if (state.audienceKind === "list") return state.recipientListId === null;
  if (state.audienceKind === "segment") return state.segmentId === null;
  return false;
}
