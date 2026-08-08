import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import type { PrismaService } from "../prisma/prisma.service";
import { MessagePageEventsService } from "./message-page-events.service";

/** A ConfigService whose get() returns a fixed MESSAGE_EVENTS_ENABLED value. */
function configWith(flag: string | undefined): ConfigService<EnvConfig, true> {
  return { get: () => flag } as unknown as ConfigService<EnvConfig, true>;
}

describe("MessagePageEventsService", () => {
  const ref = { messagePageLinkId: "link-1", messagePageId: "page-1", accountId: "acct-1" };

  it("writes one event, with the link identity denormalised, when capture is enabled", async () => {
    const create = jest.fn().mockResolvedValue({ id: "evt-1" });
    const prisma = { messagePageEvent: { create } } as unknown as PrismaService;

    await new MessagePageEventsService(prisma, configWith("true")).record("viewed", ref);

    expect(create).toHaveBeenCalledWith({ data: { type: "viewed", ...ref } });
  });

  it("treats '1' as enabled too", async () => {
    const create = jest.fn().mockResolvedValue({ id: "evt-1" });
    const prisma = { messagePageEvent: { create } } as unknown as PrismaService;

    await new MessagePageEventsService(prisma, configWith("1")).record("cta_clicked", ref);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the flag is unset (ships dark)", async () => {
    const create = jest.fn();
    const prisma = { messagePageEvent: { create } } as unknown as PrismaService;

    await new MessagePageEventsService(prisma, configWith(undefined)).record("viewed", ref);

    expect(create).not.toHaveBeenCalled();
  });

  it("swallows a write failure so capture can never break the public request", async () => {
    const create = jest.fn().mockRejectedValue(new Error("db down"));
    const prisma = { messagePageEvent: { create } } as unknown as PrismaService;
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await expect(
      new MessagePageEventsService(prisma, configWith("true")).record("replied", ref),
    ).resolves.toBeUndefined();
  });
});
