import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EventPruneResult {
  deleted: number;
  retentionDays: number;
  cutoff: Date;
}

/**
 * Retention for the message-page engagement event log (ADR 0136, Phase 3).
 *
 * A daily prune keeps the raw event table bounded: charts only ever read a
 * window (Phase 4/5) and the lifetime counters on MessagePageLink hold the
 * long-term totals, so events older than MESSAGE_EVENTS_RETENTION_DAYS are pure
 * storage/WAL cost. Prune-only for now — no rollup table until a longer-than-
 * retention window is actually wanted.
 *
 * Runs regardless of MESSAGE_EVENTS_ENABLED (the delete is a cheap indexed
 * no-op on an empty table, and a table left behind after capture is switched
 * off should still drain). The DELETE is scoped strictly to events past the
 * cutoff, so it can only ever touch this one table.
 */
@Injectable()
export class MessagePageEventsRetentionService {
  private readonly logger = new Logger(MessagePageEventsRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  private retentionDays(): number {
    return this.config.get("MESSAGE_EVENTS_RETENTION_DAYS", { infer: true });
  }

  /** 03:30 daily — offset from the 03:00 storage reaper so the two nightly
   * DELETE jobs don't contend. */
  @Cron("30 3 * * *")
  async runScheduled(): Promise<void> {
    try {
      const { deleted, retentionDays } = await this.prune();
      this.logger.log(
        `Message-page event prune done: ${deleted} removed (older than ${retentionDays}d)`,
      );
    } catch (error) {
      // A scheduled failure must not crash the process — log and wait for the
      // next run; unpruned events only cost a little extra storage.
      this.logger.error(
        `Message-page event prune failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /** Delete every event older than the retention window. `now` is injectable so
   * tests can pin the cutoff. */
  async prune(now: Date = new Date()): Promise<EventPruneResult> {
    const retentionDays = this.retentionDays();
    const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);
    const { count } = await this.prisma.messagePageEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return { deleted: count, retentionDays, cutoff };
  }
}
