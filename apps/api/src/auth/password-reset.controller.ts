import { Body, Controller, HttpCode, Post } from "@nestjs/common";
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

  @Public()
  @Post("request-password-reset")
  @HttpCode(200)
  async requestReset(@Body() dto: RequestPasswordResetDto): Promise<{ ok: true }> {
    await this.passwordReset.requestReset(dto.email);
    return { ok: true };
  }
}
