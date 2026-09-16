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
 *
 * The throttle is a flood guard, not a spam guard — five a minute per IP was
 * never going to stop bot form-fillers arriving from scattered addresses. That
 * job belongs to the gate in spam-signals.ts, which classifies rather than
 * refuses, so this endpoint's answer is the same either way.
 * See docs/adr/0101-enterprise-plan-enquiries.md and ADR 0244.
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
    // The ack reports **acceptance, not triage**, and so is hardcoded rather
    // than echoing the stored row. A submission the spam gate caught is stored
    // as `spam`, and reporting that here would hand a crawler the single bit of
    // feedback it needs to tune its way around the gate. Every submission this
    // endpoint accepts is new to us; what happens to it next is ops' business.
    // See ADR 0244.
    return { id: enquiry.id, status: "new" };
  }
}
