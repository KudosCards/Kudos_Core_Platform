import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import { CatalogSyncService, type CatalogSyncSummary } from "./catalog-sync.service";

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
  constructor(private readonly catalogSync: CatalogSyncService) {}

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
}
