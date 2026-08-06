import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import type { Paginated } from "../common/paginated";
import type { FulfillmentCalendar } from "@kudos/shared-types";
import {
  FulfillmentService,
  type FulfillmentJob,
  type FulfillmentQueueRow,
  type FulfillmentCounts,
  type MustShipSummary,
  type BulkTransitionSummary,
  type ExportedAddress,
  type PrintRunCard,
  type DeliveryPollResult,
} from "./fulfillment.service";
import { DeliveryPollService } from "./delivery-poll.service";
import { ListFulfillmentQueryDto } from "./dto/list-fulfillment-query.dto";
import { CalendarQueryDto } from "./dto/calendar-query.dto";
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
  constructor(
    private readonly fulfillmentService: FulfillmentService,
    private readonly deliveryPoll: DeliveryPollService,
  ) {}

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

  /** The send-by-5 must-ship watch-list: open cards overdue / due today / due
   * within 5 working days, plus the most urgent ones. Powers the ops must-ship
   * band + shell banner (and the daily reminder reuses the service). See ADR 0115. */
  @Get("must-ship")
  mustShip(): Promise<MustShipSummary> {
    return this.fulfillmentService.mustShip();
  }

  /** The open posting workload per day for the dispatch calendar (see ADR 0110). */
  @Get("calendar")
  calendar(@Query() query: CalendarQueryDto): Promise<FulfillmentCalendar> {
    return this.fulfillmentService.calendar(query.from, query.to);
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

  /** Ops diagnostic: fire one real read-only Click & Drop call and return the raw
   * HTTP status + body + the endpoint/scheme used, so a bad key or base URL is
   * pinpointed in seconds without waiting for the background sweep. Never creates
   * an order. Gated by PlatformAdminGuard like the rest of this controller. */
  @Post("click-and-drop/test")
  testClickAndDrop() {
    return this.fulfillmentService.testClickAndDrop();
  }

  /** Ops readout: how many fulfillment jobs have imported into Click & Drop vs
   * are errored or still awaiting a push, with a few sampled `ORD-…` references
   * an operator can search the dashboard for to confirm our orders land in the
   * right account. Read-only. Gated by PlatformAdminGuard. See ADR 0114. */
  @Get("click-and-drop/import-status")
  clickAndDropImportStatus() {
    return this.fulfillmentService.clickAndDropImportStatus();
  }

  /** Retry importing a card into the Click & Drop dashboard queue after a failed
   * push (the background sweep imports automatically; this is the manual retry). */
  @Post("jobs/:id/click-and-drop")
  retryClickAndDrop(@Param("id", ParseUUIDPipe) id: string): Promise<FulfillmentQueueRow> {
    return this.fulfillmentService.retryClickAndDrop(id);
  }

  /** Run the Royal Mail delivery poll on demand: sweep posted-with-tracking cards
   * and auto-advance any the carrier reports delivered. The hourly cron does this
   * automatically; this lets an operator force a sweep (and confirm the wiring).
   * Returns how many were checked / delivered / failed. */
  @Post("poll-deliveries")
  pollDeliveries(): Promise<DeliveryPollResult> {
    return this.deliveryPoll.runPoll();
  }
}
