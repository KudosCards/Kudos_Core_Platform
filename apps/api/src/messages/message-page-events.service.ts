import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MessagePageEventType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** A resolved link's identity, denormalised onto each event so account- and
 * page-level time-series never join back through links (ADR 0136). */
export interface MessagePageEventRef {
  messagePageLinkId: string;
  messagePageId: string;
  accountId: string;
}

/**
 * Append-only engagement-event capture for message pages (ADR 0136, Phase 2).
 *
 * Ships DARK behind MESSAGE_EVENTS_ENABLED and is strictly a side effect of the
 * public view / CTA-click / reply endpoints: neither a write failure nor the
 * flag being off may affect the response those endpoints return. So `record`
 * no-ops when disabled and swallows every write error — analytics can never
 * deny a recipient their card's message, its link, or a reply.
 *
 * Events are deliberately PII-free (no IP, user-agent, or free text): just which
 * card, what kind, and when. The lifetime counters on MessagePageLink stay the
 * source of truth for current-state totals; these events exist only for
 * over-time analytics.
 */
@Injectable()
export class MessagePageEventsService {
  private readonly logger = new Logger(MessagePageEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  /** Whether capture is armed. Read live (not cached) so flipping the env flag
   * off stops capture instantly, with no redeploy. */
  private enabled(): boolean {
    const raw = this.config.get("MESSAGE_EVENTS_ENABLED", { infer: true });
    return raw === "true" || raw === "1";
  }

  /**
   * Record one engagement event. A no-op when capture is disabled; on any write
   * failure it logs and returns. Safe to `await` on the public hot path: it
   * never throws.
   */
  async record(type: MessagePageEventType, ref: MessagePageEventRef): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.prisma.messagePageEvent.create({
        data: {
          type,
          messagePageLinkId: ref.messagePageLinkId,
          messagePageId: ref.messagePageId,
          accountId: ref.accountId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Event capture (${type}) failed for link ${ref.messagePageLinkId}: ${reasonOf(error)}`,
      );
    }
  }
}
