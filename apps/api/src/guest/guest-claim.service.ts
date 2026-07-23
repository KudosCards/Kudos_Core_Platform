import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SAFE_ACCOUNT_SELECT, type SafeAccount } from "../accounts/accounts.service";
import type { AuthenticatedUser } from "../auth/types";

/** Turn a guest buyer's email into a friendly default account name. */
function deriveAccountName(email: string): string {
  const local = email.split("@")[0] ?? "My account";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * Claiming a guest account: a buyer who checked out without an account attaches
 * a login to the account their order already lives on, using the single-use
 * claim token from their receipt / success page. See docs/adr/0025.
 */
@Injectable()
export class GuestClaimService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public prefill — the buyer's email for the claim form, or 404 if the token
   * is unknown or expired. Reveals only the email tied to the token the caller
   * already holds. */
  async getInfo(token: string): Promise<{ email: string }> {
    const account = await this.prisma.account.findFirst({
      where: { claimToken: token, claimTokenExpiresAt: { gt: new Date() } },
      select: { contactEmail: true },
    });
    if (!account?.contactEmail) {
      throw new NotFoundException("This claim link is invalid or has expired");
    }
    return { email: account.contactEmail };
  }

  /**
   * Attach the authenticated user to the guest account behind `token`. Requires
   * a valid, unexpired token AND that the user's (Supabase-confirmed) email
   * matches the email the order was bought with — the token alone isn't enough.
   * Single-use: the token is cleared on success.
   */
  async claim(user: AuthenticatedUser, token: string): Promise<SafeAccount> {
    if (!user.email) {
      throw new ForbiddenException("Your login has no email address");
    }
    const email = user.email;

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({
        where: { claimToken: token, claimTokenExpiresAt: { gt: new Date() } },
      });
      if (!account) {
        throw new NotFoundException("This claim link is invalid or has expired");
      }
      if (account.contactEmail && account.contactEmail.toLowerCase() !== email.toLowerCase()) {
        throw new ForbiddenException("This order was bought with a different email address");
      }
      // A user can only own one account in this phase; if they already have one,
      // the v1 answer is "log in to your existing account" (moving the guest
      // order across accounts is a later enhancement — see docs/adr/0025).
      const existing = await tx.membership.findFirst({ where: { userId: user.id } });
      if (existing) {
        throw new ConflictException(
          "You already have an account — log in to see your orders",
        );
      }

      await tx.membership.create({
        data: { accountId: account.id, userId: user.id, role: "owner", email },
      });
      return tx.account.update({
        where: { id: account.id },
        data: { claimToken: null, claimTokenExpiresAt: null, name: deriveAccountName(email) },
        select: SAFE_ACCOUNT_SELECT,
      });
    });
  }
}
