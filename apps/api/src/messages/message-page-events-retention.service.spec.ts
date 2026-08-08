import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import type { PrismaService } from "../prisma/prisma.service";
import { MessagePageEventsRetentionService } from "./message-page-events-retention.service";

function configWith(days: number): ConfigService<EnvConfig, true> {
  return { get: () => days } as unknown as ConfigService<EnvConfig, true>;
}

describe("MessagePageEventsRetentionService", () => {
  it("deletes events older than the retention window and reports the count + cutoff", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 7 });
    const prisma = { messagePageEvent: { deleteMany } } as unknown as PrismaService;
    const service = new MessagePageEventsRetentionService(prisma, configWith(90));

    const result = await service.prune(new Date("2026-08-08T00:00:00.000Z"));

    // 90 days before 2026-08-08 is 2026-05-10.
    expect(result).toEqual({
      deleted: 7,
      retentionDays: 90,
      cutoff: new Date("2026-05-10T00:00:00.000Z"),
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: result.cutoff } } });
  });

  it("honours a custom retention window", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = { messagePageEvent: { deleteMany } } as unknown as PrismaService;
    const service = new MessagePageEventsRetentionService(prisma, configWith(30));

    const { cutoff, retentionDays } = await service.prune(new Date("2026-08-08T00:00:00.000Z"));

    expect(retentionDays).toBe(30);
    expect(cutoff).toEqual(new Date("2026-07-09T00:00:00.000Z"));
  });

  it("scheduled run swallows a failure instead of crashing the process", async () => {
    const deleteMany = jest.fn().mockRejectedValue(new Error("db down"));
    const prisma = { messagePageEvent: { deleteMany } } as unknown as PrismaService;
    const service = new MessagePageEventsRetentionService(prisma, configWith(90));
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await expect(service.runScheduled()).resolves.toBeUndefined();
  });
});
