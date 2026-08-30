import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Account, PlanEntitlement } from "@prisma/client";
import { AccountsService, type SafeAccount } from "./accounts.service";
import { DashboardService, type DashboardSummary, type NavBadges } from "./dashboard.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { CreateAccountDto } from "./dto/create-account.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { UpdateNotificationsDto } from "./dto/update-notifications.dto";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { MembershipGuard } from "../auth/membership.guard";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";

@ApiTags("accounts")
@ApiBearerAuth()
@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly entitlements: EntitlementsService,
    private readonly dashboard: DashboardService,
  ) {}

  /** No MembershipGuard here — this is what creates the user's first Membership. */
  @Post()
  signup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAccountDto): Promise<Account> {
    // The signer's own account, so the address is contact detail rather than an
    // authorization input — the claim is the right source. It becomes the
    // account's contactEmail, which a later guest claim compares against; that
    // comparison is made against a *confirmed* address on the other side. ADR 0188.
    return this.accountsService.signup(user.id, dto, user.unverifiedEmail);
  }

  /** Toggle birthday-reminder emails (opt-out). */
  @UseGuards(MembershipGuard)
  @Patch("me/notifications")
  updateNotifications(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: UpdateNotificationsDto,
  ): Promise<SafeAccount> {
    return this.accountsService.updateNotifications(
      membership.accountId,
      dto.reminderEmailsEnabled,
    );
  }

  @UseGuards(MembershipGuard)
  @Get("me")
  getCurrentAccount(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<SafeAccount> {
    return this.accountsService.findById(membership.accountId);
  }

  /** Permanently delete the account and all its data (owner-only, irreversible).
   * Cancels any live Stripe subscription and removes the Supabase logins. */
  @UseGuards(MembershipGuard)
  @Delete("me")
  @HttpCode(204)
  async deleteCurrentAccount(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: DeleteAccountDto,
  ): Promise<void> {
    await this.accountsService.deleteAccount(
      membership.accountId,
      membership.role,
      dto.confirmName,
    );
  }

  /** The account's plan limits and feature gates — lets the UI show/hide
   * capabilities (e.g. the auto-send opt-in) without hardcoding plan knowledge. */
  @UseGuards(MembershipGuard)
  @Get("me/entitlements")
  getEntitlements(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<PlanEntitlement> {
    return this.entitlements.getForAccount(membership.accountId);
  }

  /** Home-screen counts + wallet balance for the dashboard. */
  @UseGuards(MembershipGuard)
  @Get("me/summary")
  getSummary(@CurrentMembership() membership: CurrentMembershipContext): Promise<DashboardSummary> {
    return this.dashboard.getSummary(membership.accountId);
  }

  /** The three counts the app shell renders on every page — deliberately cheap
   * (see NavBadges). The full summary above is only for the dashboard. */
  @UseGuards(MembershipGuard)
  @Get("me/nav-badges")
  getNavBadges(@CurrentMembership() membership: CurrentMembershipContext): Promise<NavBadges> {
    return this.dashboard.getNavBadges(membership.accountId);
  }
}
