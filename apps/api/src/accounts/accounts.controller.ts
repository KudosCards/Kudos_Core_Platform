import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Account } from "@prisma/client";
import { AccountsService } from "./accounts.service";
import { CreateAccountDto } from "./dto/create-account.dto";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { MembershipGuard } from "../auth/membership.guard";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";

@ApiTags("accounts")
@ApiBearerAuth()
@Controller("accounts")
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /** No MembershipGuard here — this is what creates the user's first Membership. */
  @Post()
  signup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAccountDto): Promise<Account> {
    return this.accountsService.signup(user.id, dto);
  }

  @UseGuards(MembershipGuard)
  @Get("me")
  getCurrentAccount(@CurrentMembership() membership: CurrentMembershipContext): Promise<Account> {
    return this.accountsService.findById(membership.accountId);
  }
}
