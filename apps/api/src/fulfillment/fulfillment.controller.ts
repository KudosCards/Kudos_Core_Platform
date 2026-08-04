import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import type { Paginated } from "../common/paginated";
import {
  FulfillmentService,
  type FulfillmentJob,
  type FulfillmentQueueRow,
  type FulfillmentCounts,
  type BulkTransitionSummary,
  type ExportedAddress,
  type PrintRunCard,
} from "./fulfillment.service";
import { ListFulfillmentQueryDto } from "./dto/list-fulfillment-query.dto";
import { TransitionFulfillmentDto } from "./dto/transition-fulfillment.dto";
import { BulkTransitionFulfillmentDto } from "./dto/bulk-transition-fulfillment.dto";
import { ExportAddressesDto } from "./dto/export-addresses.dto";

/**
 * The internal print/post team's queue. Every route is gated by
 * PlatformAdminGuard — this is the API's only cross-account-privileged
 * surface (see docs/adr/0010).
 */
@ApiTags("fulfillment")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("fulfillment")
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  /** Lightweight check the web ops shell uses to gate its routes: a 200 means
   * the caller is a platform admin, a 403 (from the guard) means they aren't. */
  @Get("me")
  me(@CurrentPlatformAdmin() admin: PlatformAdminContext): { userId: string } {
    return { userId: admin.userId };
  }

  @Get("jobs")
  list(@Query() query: ListFulfillmentQueryDto): Promise<Paginated<FulfillmentQueueRow>> {
    return this.fulfillmentService.list(query);
  }

  /** Per-status job counts plus due-date urgency buckets for the queue's filter
   * chips (see ADR 0108). */
  @Get("counts")
  counts(): Promise<FulfillmentCounts> {
    return this.fulfillmentService.counts();
  }

  @Get("jobs/:id")
  findOne(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<FulfillmentJob> {
    return this.fulfillmentService.findOne(admin.userId, id);
  }

  /** Pull full dispatch addresses for a print run — the audited path to the
   * street address the queue list deliberately withholds (see the service). */
  @Post("export")
  exportAddresses(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: ExportAddressesDto,
  ): Promise<ExportedAddress[]> {
    return this.fulfillmentService.exportAddresses(admin.userId, dto);
  }

  /** Pull the personalised card faces for a print run — the audited path to
   * produce one PDF of the whole run, names already merged in. */
  @Post("print-run")
  printRun(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: ExportAddressesDto,
  ): Promise<PrintRunCard[]> {
    return this.fulfillmentService.printRun(admin.userId, dto);
  }

  @Post("jobs/:id/claim")
  claim(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<FulfillmentQueueRow> {
    return this.fulfillmentService.claim(admin.userId, id);
  }

  @Post("jobs/:id/transition")
  transition(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TransitionFulfillmentDto,
  ): Promise<FulfillmentQueueRow> {
    return this.fulfillmentService.transition(admin.userId, id, dto);
  }

  @Post("jobs/bulk-transition")
  bulkTransition(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: BulkTransitionFulfillmentDto,
  ): Promise<BulkTransitionSummary> {
    return this.fulfillmentService.bulkTransition(admin.userId, dto);
  }

  /** Whether Royal Mail shipping automation is wired — the ops UI shows the
   * "Dispatch via Royal Mail" action only when true. */
  @Get("shipping-status")
  shippingStatus(): { enabled: boolean } {
    return { enabled: this.fulfillmentService.shippingAutomationEnabled() };
  }

  /** Auto-create a Royal Mail shipment for a printed card and mark it posted,
   * storing the tracking number + label. */
  @Post("jobs/:id/dispatch")
  dispatch(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<FulfillmentQueueRow> {
    return this.fulfillmentService.dispatch(admin.userId, id);
  }

  /** Bulk auto-dispatch a print run via Royal Mail. */
  @Post("jobs/dispatch")
  dispatchMany(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: ExportAddressesDto,
  ): Promise<{ dispatched: number; failed: number }> {
    return this.fulfillmentService.dispatchMany(admin.userId, dto.jobIds);
  }

  /** Whether Click & Drop order-import is wired — the ops UI shows the import
   * status column + retry action only when true. */
  @Get("click-and-drop-status")
  clickAndDropStatus(): { enabled: boolean } {
    return { enabled: this.fulfillmentService.clickAndDropEnabled() };
  }

  /** Retry importing a card into the Click & Drop dashboard queue after a failed
   * push (the background sweep imports automatically; this is the manual retry). */
  @Post("jobs/:id/click-and-drop")
  retryClickAndDrop(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<FulfillmentQueueRow> {
    return this.fulfillmentService.retryClickAndDrop(id);
  }
}
