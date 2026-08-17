import { BadRequestException, Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import type { CardDesign } from "@prisma/client";
import { Public } from "../auth/public.decorator";
import { CardDesignsService } from "./card-designs.service";
import { ListCardDesignsQueryDto } from "./dto/list-card-designs-query.dto";

/**
 * A UUID or a slug: lowercase alphanumerics and single hyphens, 1-100 chars.
 * Wide enough for every slug `slugifyCardName()` can produce (it caps at 80 and
 * suffixes collisions), narrow enough that junk never reaches a query.
 */
const CARD_IDENTIFIER_PATTERN = /^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$/i;

/**
 * The card catalog is public: it's the marketing card library an unauthenticated
 * visitor browses before signing up ("pick a card → personalise → sign up", see
 * docs/adr/0017-public-card-library.md). Only active templates are returned
 * (the service filters isActive), and templates carry no account data.
 *
 * Rate-limited per IP: these are the only unauthenticated reads in the app, so
 * they carry no per-account throttle key — the per-IP ThrottlerGuard keeps a
 * scraper or a hot loop from hammering the catalog. The limit is generous
 * because a genuine gallery browse fires several requests in quick succession.
 */
@ApiTags("card-designs")
@Controller("card-designs")
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class CardDesignsController {
  constructor(private readonly cardDesignsService: CardDesignsService) {}

  @Public()
  @Get()
  list(@Query() query: ListCardDesignsQueryDto): Promise<CardDesign[]> {
    return this.cardDesignsService.list(query);
  }

  /**
   * Accepts a design's UUID **or** its public slug. The catalog moved to
   * `/cards/<category>/<slug>` (ADR 0163) so the web app resolves by slug, while
   * the UUID form stays live for links already indexed or printed on a QR code.
   *
   * ParseUUIDPipe is deliberately gone, but the shape is still validated: this
   * is an unauthenticated endpoint, so an unbounded path segment shouldn't reach
   * the database.
   */
  @Public()
  @Get(":idOrSlug")
  findOne(@Param("idOrSlug") idOrSlug: string): Promise<CardDesign> {
    if (!CARD_IDENTIFIER_PATTERN.test(idOrSlug)) {
      throw new BadRequestException("Not a valid card id or slug");
    }
    return this.cardDesignsService.findOne(idOrSlug);
  }
}
