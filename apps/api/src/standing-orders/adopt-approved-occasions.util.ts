import type { Prisma, PrismaClient } from "@prisma/client";
import { MISSING_ADDRESS_WHERE } from "../recipients/recipients.service";
import { startOfUtcDay } from "../occasions/birthday-occasion.util";

/** Anything that can run the update: the PrismaService or a transaction client. */
type PrismaLike = Pick<PrismaClient, "occasion"> | Prisma.TransactionClient;

/** What the instruction covers, as far as adoption needs to know. */
export interface AdoptionScope {
  accountId: string;
  /** Set when the instruction targets one list; null when it covers everybody. */
  recipientListId: string | null;
}

/**
 * Hand the cards already approved and waiting to the instruction that has just
 * started running.
 *
 * Switching click and forget on used to change nothing about a card somebody
 * had already approved. The approval cron only ever reads `pending_approval`,
 * so an `approved` card carrying `asap` stayed that way: waiting for a human to
 * place an order, on no screen that asked them to, and retired as `missed` once
 * the date passed. Somebody who worked through a fortnight of birthdays by hand
 * and *then* switched automation on was left with exactly that — the instruction
 * said "we are sending these cards for you" over a set of cards it would never
 * touch.
 *
 * Bounded the same way the approval cron is bounded, and then some:
 *
 * - **Only what the instruction covers.** Birthdays, rolling per-recipient ones,
 *   active contacts, and in the list when it targets one. A card for somebody
 *   outside the audience is not this instruction's to take.
 * - **Only cards that can still be posted.** A dispatch date already gone is not
 *   made good by sending it late, and that is the account's call rather than
 *   ours.
 * - **Only contacts we could actually post to.** An adopted card with no address
 *   would vanish from the "waiting for you to order" list into the automated one
 *   and then silently fail at the cron. Left alone, it stays on the screen that
 *   asks a person to fix it.
 *
 * The postage class and dispatch date are **not** re-timed. Whoever approved
 * this card chose them, and adoption is a promise to send what they set up
 * without being asked again — not licence to change it.
 *
 * Called only on the transition into running, never on an ordinary save: a card
 * deliberately left on `asap` while the instruction is already running is a
 * choice, and re-adopting it on the next unrelated edit would quietly overrule
 * somebody who had used the exact escape hatch the queue offers them.
 */
export async function adoptApprovedIntoAutoSend(
  prisma: PrismaLike,
  scope: AdoptionScope,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.occasion.updateMany({
    where: {
      accountId: scope.accountId,
      status: "approved",
      dispatchOption: "asap",
      type: "birthday",
      source: "recurring_per_recipient",
      // Approved means a design was chosen; this is belt and braces, because
      // auto-send has nothing to print without one.
      savedDesignId: { not: null },
      dispatchDate: { gte: startOfUtcDay(now) },
      recipient: {
        status: "active",
        NOT: MISSING_ADDRESS_WHERE,
        ...(scope.recipientListId
          ? { listMemberships: { some: { listId: scope.recipientListId } } }
          : {}),
      },
    },
    data: { dispatchOption: "auto_send" },
  });
  return count;
}
