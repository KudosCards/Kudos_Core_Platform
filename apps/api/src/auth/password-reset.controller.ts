import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "./public.decorator";
import { PasswordResetService } from "./password-reset.service";
import { RequestPasswordResetDto } from "./dto/request-password-reset.dto";

/**
 * Public "forgot password" entry. Always responds 200 regardless of whether the
 * email has an account, so it can't be used to enumerate registered addresses —
 * the service silently no-ops for unknown emails. See docs/adr/0051.
 */
@ApiTags("auth")
@Controller("auth")
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  /**
   * Rate-limited per client IP: this is anonymous and sends an email on every
   * call, so without a cap it's an email-bombing / send-quota-abuse vector (a
   * known address could be flooded with reset emails). 5/min is ample for a
   * real person who mistyped once. See ADR 0134; the real-client-IP keying it
   * relies on is ADR 0133.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("request-password-reset")
  @HttpCode(200)
  async requestReset(@Body() dto: RequestPasswordResetDto): Promise<{ ok: true }> {
    await this.passwordReset.requestReset(dto.email);
    return { ok: true };
  }
}
