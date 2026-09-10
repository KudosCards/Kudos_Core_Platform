import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { SuperAdminGuard } from "../auth/super-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import type { WalletCampaignView } from "@kudos/shared-types";
import { WalletCampaignsAdminService } from "./wallet-campaigns-admin.service";
import {
  CreateWalletCampaignDto,
  SetWalletCampaignStatusDto,
  UpdateWalletCampaignDto,
} from "./dto/wallet-campaign.dto";

/**
 * Marketing wallet campaigns — "sign up in October and get £5 free credit".
 *
 * Mounted under `admin/` but kept out of AdminController, which already carries
 * ten collaborators: this needs the campaign module, and the campaign module
 * needs Supabase and the operator inbox, none of which the admin surface should
 * pull in to show a dashboard.
 *
 * Reading is an ops job and changing is not, so mutations are super-admin only
 * — the same line ADR 0040 draws across every platform setting, and here it
 * guards a control that gives money to every new customer. Pinned by
 * admin/admin-mutations-guarded.spec.ts.
 */
@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("admin/wallet-campaigns")
export class WalletCampaignsController {
  constructor(private readonly campaigns: WalletCampaignsAdminService) {}

  /** Every campaign, newest first, with what each has actually paid out. */
  @Get()
  async list(): Promise<{ campaigns: WalletCampaignView[] }> {
    return { campaigns: await this.campaigns.list() };
  }

  /** Create a campaign. Always `draft` — nothing is credited until someone
   *  reads back what they typed and sets it live. */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post()
  create(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: CreateWalletCampaignDto,
  ): Promise<WalletCampaignView> {
    return this.campaigns.create(admin.userId, dto);
  }

  /** Correct a campaign. The amount and dates are draft-only; the name and
   *  budget stay editable until it ends. */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Put(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateWalletCampaignDto,
  ): Promise<WalletCampaignView> {
    return this.campaigns.update(id, dto);
  }

  /** Start, pause, resume or stop a campaign. */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Put(":id/status")
  setStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetWalletCampaignStatusDto,
  ): Promise<WalletCampaignView> {
    return this.campaigns.setStatus(id, dto.status);
  }
}
