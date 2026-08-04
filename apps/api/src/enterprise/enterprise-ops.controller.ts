import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { EnterpriseEnquiry } from "@kudos/shared-types";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import type { Paginated } from "../common/paginated";
import { EnterpriseService } from "./enterprise.service";
import { ListEnterpriseQueryDto } from "./dto/list-enterprise-query.dto";
import { UpdateEnterpriseEnquiryDto } from "./dto/update-enterprise-enquiry.dto";

/**
 * The ops (PlatformAdmin) side of Enterprise leads: work the queue and move a
 * lead through triage. Cross-account-privileged like the other admin queues.
 * See docs/adr/0010, docs/adr/0101-enterprise-plan-enquiries.md.
 */
@ApiTags("enterprise-ops")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("admin/enterprise-enquiries")
export class EnterpriseOpsController {
  constructor(private readonly enterprise: EnterpriseService) {}

  @Get()
  list(@Query() query: ListEnterpriseQueryDto): Promise<Paginated<EnterpriseEnquiry>> {
    return this.enterprise.list(query);
  }

  @Patch(":id")
  updateStatus(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id") id: string,
    @Body() dto: UpdateEnterpriseEnquiryDto,
  ): Promise<EnterpriseEnquiry> {
    return this.enterprise.updateStatus(admin.userId, id, dto.status);
  }
}
