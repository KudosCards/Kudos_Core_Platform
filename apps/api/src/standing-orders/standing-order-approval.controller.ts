import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import {
  StandingOrderApprovalService,
  type StandingOrderApprovalResult,
} from "./standing-order-approval.service";

/**
 * Ops-only manual trigger for the standing-order approval run — the same job
 * the 06:30 cron fires. Gated by PlatformAdminGuard for the reason the
 * auto-send trigger is: it acts across every account. See docs/adr/0257.
 */
@ApiTags("standing-order-approval")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("standing-order-approval")
export class StandingOrderApprovalController {
  constructor(private readonly approval: StandingOrderApprovalService) {}

  @Post("run")
  run(@CurrentPlatformAdmin() _admin: PlatformAdminContext): Promise<StandingOrderApprovalResult> {
    return this.approval.runDue();
  }
}
