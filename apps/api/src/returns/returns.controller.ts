import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import { ReturnsService, type ReturnCaseView } from "./returns.service";
import { RecoveryAddressDto } from "./dto/recovery-address.dto";

/**
 * The customer side of Returned to Sender: see your returned cards, update the
 * address, then recover the card once for free — resent to the corrected
 * address or hand-delivered to your business — or archive it. See ADR 0039.
 */
@ApiTags("returns")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("returns")
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@CurrentMembership() membership: CurrentMembershipContext): Promise<ReturnCaseView[]> {
    return this.returns.listForAccount(membership.accountId);
  }

  @Get(":id")
  get(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReturnCaseView> {
    return this.returns.getForAccount(membership.accountId, id);
  }

  /** Update the contact's address after a return; advances the case to
   * "awaiting resend" so a recovery can be chosen. */
  @Post(":id/address")
  updateAddress(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecoveryAddressDto,
  ): Promise<ReturnCaseView> {
    return this.returns.updateAddress(membership.accountId, user.id, id, dto);
  }

  /** Option A — free resend to the corrected recipient address (Kudos Promise). */
  @Post(":id/resend")
  resend(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReturnCaseView> {
    return this.returns.resendToRecipient(membership.accountId, user.id, id);
  }

  /** Option B — free hand-delivery to the business address (Kudos Promise). */
  @Post(":id/send-to-business")
  sendToBusiness(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecoveryAddressDto,
  ): Promise<ReturnCaseView> {
    return this.returns.sendToBusiness(membership.accountId, user.id, id, dto);
  }

  @Post(":id/archive")
  archive(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReturnCaseView> {
    return this.returns.archive(membership.accountId, user.id, id);
  }
}
