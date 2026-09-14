import { Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import { CatalogSyncService, type CatalogSyncSummary } from "./catalog-sync.service";
import { CatalogCropGateService } from "./catalog-crop-gate.service";
import { UpdateCropGateDto } from "./dto/update-crop-gate.dto";
import { SuperAdminGuard } from "../auth/super-admin.guard";

/**
 * Ops-only control surface for the card catalog. Gated by PlatformAdminGuard —
 * syncing the catalog is a Kudos-internal action, not something a tuition-centre
 * customer can trigger. See docs/adr/0011-airtable-catalog-sync.md.
 */
@ApiTags("catalog")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("catalog")
export class CatalogController {
  constructor(
    private readonly catalogSync: CatalogSyncService,
    private readonly cropGate: CatalogCropGateService,
  ) {}

  /** Whether Airtable credentials are wired, so the ops UI can explain a
   * "not configured" state instead of failing a sync. */
  @Get("status")
  status(@CurrentPlatformAdmin() _admin: PlatformAdminContext): { configured: boolean } {
    return { configured: this.catalogSync.isConfigured() };
  }

  /** Pull the latest active cards from Airtable into the catalog. */
  @Post("sync")
  sync(@CurrentPlatformAdmin() _admin: PlatformAdminContext): Promise<CatalogSyncSummary> {
    return this.catalogSync.sync();
  }

  /** Whether the sync currently refuses artwork that would be cropped. */
  @Get("crop-gate")
  async cropGateState(): Promise<{ enabled: boolean }> {
    return { enabled: await this.cropGate.isEnabled() };
  }

  /**
   * Switch the refusal on or off. Super admin only: closing it while the
   * catalog is still 2:3 would refuse 207 of 217 designs, which is a decision
   * about the shop rather than a routine ops action.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Put("crop-gate")
  async updateCropGate(@Body() dto: UpdateCropGateDto): Promise<{ enabled: boolean }> {
    return { enabled: await this.cropGate.setEnabled(dto.enabled) };
  }
}
