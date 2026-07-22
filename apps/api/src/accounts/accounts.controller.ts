import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Account, PlanEntitlement } from "@prisma/client";
import { AccountsService, type SafeAccount } from "./accounts.service";
import { DashboardService, type DashboardSummary } from "./dashboard.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { CreateAccountDto } from "./dto/create-account.dto";
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
    return this.accountsService.signup(user.id, dto, user.email);
  }

  /** Toggle birthday-reminder emails (opt-out). */
  @UseGuards(MembershipGuard)
  @Patch("me/notifications")
  updateNotifications(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: UpdateNotificationsDto,
  ): Promise<SafeAccount> {
    return this.accountsService.updateNotifications(membership.accountId, dto.reminderEmailsEnabled);
  }

  @UseGuards(MembershipGuard)
  @Get("me")
  getCurrentAccount(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<SafeAccount> {
    return this.accountsService.findById(membership.accountId);
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
  getSummary(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<DashboardSummary> {
    return this.dashboard.getSummary(membership.accountId);
  }
}
