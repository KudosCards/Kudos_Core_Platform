import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import type { CheckoutResult } from "../common/checkout-result";
import type { BatchOrder } from "../batch-orders/batch-orders.service";
import { WalletService, type WalletSummary } from "./wallet.service";
import { TopUpDto } from "./dto/top-up.dto";
import { AutoTopUpDto } from "./dto/auto-top-up.dto";

@ApiTags("wallet")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("wallet")
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** Current balance + recent ledger entries. */
  @Get()
  getWallet(@CurrentMembership() membership: CurrentMembershipContext): Promise<WalletSummary> {
    return this.wallet.getSummary(membership.accountId);
  }

  /** Start a Stripe Checkout to add funds; the wallet is credited on webhook. */
  @Post("top-up")
  topUp(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TopUpDto,
  ): Promise<CheckoutResult> {
    return this.wallet.createTopUpCheckout(membership.accountId, user.id, dto);
  }

  /** Set (or clear) the standing top-up instruction. Saving always resumes a
   * paused instruction — see WalletService.updateAutoTopUp. */
  @Patch("auto-top-up")
  updateAutoTopUp(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AutoTopUpDto,
  ): Promise<WalletSummary> {
    return this.wallet.updateAutoTopUp(membership.accountId, user.id, dto);
  }

  /** Pay a draft batch order from the wallet balance (no Stripe redirect). */
  @Post("pay/:batchOrderId")
  pay(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("batchOrderId", ParseUUIDPipe) batchOrderId: string,
  ): Promise<BatchOrder> {
    return this.wallet.payOrder(membership.accountId, user.id, batchOrderId);
  }
}
