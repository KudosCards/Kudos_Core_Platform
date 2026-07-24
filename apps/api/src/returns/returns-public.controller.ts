import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Public } from "../auth/public.decorator";
import { ReturnsService, type ReturnCaseView } from "./returns.service";
import { RecoveryAddressDto } from "./dto/recovery-address.dto";

/**
 * The self-serve Returned-to-Sender recovery surface, reached from the link in
 * the RTS email — NO login required. Authorised solely by the secret token in
 * the URL (like the invite / guest-claim links). Throttled, since it's public.
 * Every route delegates to the same ReturnsService logic the authenticated
 * `/returns` endpoints use. See docs/adr/0039-returned-to-sender.md.
 */
@ApiTags("returns-public")
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller("rts")
export class ReturnsPublicController {
  constructor(private readonly returns: ReturnsService) {}

  /** The case behind this link, for the recovery page (no street address). */
  @Get(":token")
  get(@Param("token") token: string): Promise<ReturnCaseView> {
    return this.returns.getByToken(token);
  }

  @Post(":token/address")
  updateAddress(
    @Param("token") token: string,
    @Body() dto: RecoveryAddressDto,
  ): Promise<ReturnCaseView> {
    return this.returns.updateAddressByToken(token, dto);
  }

  @Post(":token/resend")
  resend(@Param("token") token: string): Promise<ReturnCaseView> {
    return this.returns.resendByToken(token);
  }

  @Post(":token/send-to-business")
  sendToBusiness(
    @Param("token") token: string,
    @Body() dto: RecoveryAddressDto,
  ): Promise<ReturnCaseView> {
    return this.returns.sendToBusinessByToken(token, dto);
  }

  @Post(":token/archive")
  archive(@Param("token") token: string): Promise<ReturnCaseView> {
    return this.returns.archiveByToken(token);
  }
}
