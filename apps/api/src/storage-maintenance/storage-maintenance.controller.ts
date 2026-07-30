import { Controller, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import type { PlatformAdminContext } from "../auth/types";
import { type ReapSummary, StorageReaperService } from "./storage-reaper.service";

/**
 * Ops-only control surface for storage maintenance. Gated by PlatformAdminGuard
 * — reaping orphaned artwork is a Kudos-internal janitorial action, never a
 * customer one. See docs/adr/0074-orphaned-asset-reaper.md.
 */
@ApiTags("storage-maintenance")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("storage-maintenance")
export class StorageMaintenanceController {
  constructor(private readonly reaper: StorageReaperService) {}

  /**
   * Run the reaper on demand. Defaults to a dry run (report only) so an operator
   * can see what would be reclaimed; pass `?dryRun=false` to actually delete —
   * which still requires STORAGE_REAPER_ENABLED to be set (otherwise the summary
   * comes back `dryRun: true` and nothing is deleted).
   */
  @Post("reap")
  reap(
    @CurrentPlatformAdmin() _admin: PlatformAdminContext,
    @Query("dryRun") dryRun?: string,
  ): Promise<ReapSummary> {
    // Explicit opt-out of dry run; anything else stays safe (report only).
    return this.reaper.reap({ dryRun: dryRun !== "false" });
  }
}
