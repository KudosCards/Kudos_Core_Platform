import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import { AutoSendService, type AutoSendResult } from "./auto-send.service";

/**
 * Ops-only manual trigger for the auto-send run — the same job the daily cron
 * fires, exposed so Kudos can kick it on demand (a missed run, testing). Gated
 * by PlatformAdminGuard: it acts across every account, so it is not a
 * customer-facing endpoint. See docs/adr/0013-auto-send.md.
 */
@ApiTags("auto-send")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("auto-send")
export class AutoSendController {
  constructor(private readonly autoSend: AutoSendService) {}

  @Post("run")
  run(@CurrentPlatformAdmin() _admin: PlatformAdminContext): Promise<AutoSendResult> {
    return this.autoSend.runDue();
  }
}
