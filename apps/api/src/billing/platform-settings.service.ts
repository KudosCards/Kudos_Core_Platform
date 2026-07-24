import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Keys used in the PlatformSetting store. Centralised so producers/consumers
 * can't drift on the string. */
export const PLATFORM_SETTING_KEYS = {
  centreSeatPriceId: "stripe_centre_seat_price_id",
} as const;

/**
 * A thin accessor over the PlatformSetting key→value table — platform-level
 * runtime config the app can write itself (no redeploy). See
 * docs/adr/0037-in-app-price-provisioning.md.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
