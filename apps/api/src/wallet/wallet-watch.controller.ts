import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import { WalletWatchService, type WalletWatchResult } from "./wallet-watch.service";

/**
 * Ops-only manual trigger for the wallet watch — the same job the 9am cron
 * fires. Gated by PlatformAdminGuard for the same reason the auto-send trigger
 * is: it runs across every account and can charge cards, so it is nobody's
 * customer-facing button. See docs/adr/0255.
 */
@ApiTags("wallet-watch")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("wallet-watch")
export class WalletWatchController {
  constructor(private readonly watch: WalletWatchService) {}

  @Post("run")
  run(@CurrentPlatformAdmin() _admin: PlatformAdminContext): Promise<WalletWatchResult> {
    return this.watch.runDue();
  }
}
