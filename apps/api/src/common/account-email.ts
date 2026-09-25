import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * The one address an account is reachable at: its contact email if set, else
 * the owner's membership email, else any member's — null when there is nobody
 * to write to (a guest account that never claimed, say).
 *
 * Every transactional email to a customer needs this, and it had grown three
 * identical private copies (returns, support, messages), each carrying a
 * comment saying it mirrored the others. Auto-send would have been the fourth.
 *
 * Note what this deliberately does **not** consult: `reminderEmailsEnabled`.
 * That switch is the customer's control over being nudged about cards they
 * have not sent yet. It is not consent to be kept in the dark about a card
 * that failed, an order that was returned, or a reply to their own support
 * ticket — those are service messages about something that already happened.
 */
export async function resolveAccountEmail(
  prisma: PrismaService | Prisma.TransactionClient,
  accountId: string,
): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { contactEmail: true },
  });
  if (account?.contactEmail) {
    return account.contactEmail;
  }
  const members = await prisma.membership.findMany({
    where: { accountId, email: { not: null } },
    select: { email: true, role: true },
    // Ordered, because the fallback below takes the first row. Without this the
    // order is whatever Postgres returns, which changes after an update or a
    // vacuum — so today's "we couldn't deliver your card" and next week's
    // support reply could go to two different colleagues, and the one who asked
    // never sees the answer. See ADR 0267.
    orderBy: { createdAt: "asc" },
  });
  const owner = members.find((member) => member.role === "owner");
  return owner?.email ?? members[0]?.email ?? null;
}
