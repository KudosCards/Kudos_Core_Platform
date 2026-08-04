import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { EnterpriseEnquiryAck } from "@kudos/shared-types";
import { Public } from "../auth/public.decorator";
import { EnterpriseService } from "./enterprise.service";
import { CreateEnterpriseEnquiryDto } from "./dto/create-enterprise-enquiry.dto";

/**
 * The public "Contact us" endpoint behind the /enterprise pricing option — NO
 * login required. Throttled, since it's an unauthenticated write. Deliberately
 * returns only an acknowledgement (id + status), never the stored row.
 * See docs/adr/0101-enterprise-plan-enquiries.md.
 */
@ApiTags("enterprise")
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("enterprise-enquiries")
export class EnterprisePublicController {
  constructor(private readonly enterprise: EnterpriseService) {}

  @Post()
  async create(@Body() dto: CreateEnterpriseEnquiryDto): Promise<EnterpriseEnquiryAck> {
    const enquiry = await this.enterprise.create(dto);
    return { id: enquiry.id, status: enquiry.status };
  }
}
