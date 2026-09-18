import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DesignAsset } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { hostOf } from "../print-pdf";
import { measureAsset } from "../common/measure-asset";
import type { EnvConfig } from "../config/env.schema";
import type { CreateDesignAssetDto } from "./dto/create-design-asset.dto";

/**
 * The account's reusable image library ("Your uploads" in the designer). One
 * row per completed upload; deleting a row only removes it from the library —
 * the storage object is deliberately left in place because existing design
 * documents may still reference the same url. See
 * docs/adr/0070-saved-assets-library.md.
 */
@Injectable()
export class DesignAssetsService {
  private readonly logger = new Logger(DesignAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async list(accountId: string): Promise<DesignAsset[]> {
    return this.prisma.designAsset.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: { id: true, url: true, fileName: true, width: true, height: true, createdAt: true },
    });
  }

  /**
   * Record a completed upload.
   *
   * The dimensions are measured from the stored object rather than taken from
   * the request. They were whatever the browser posted, and they decide what the
   * editor believes about the file and what the artwork gate would say about it
   * — a number the client supplies cannot answer either question, because a
   * stale tab or a forged request supplies it too. Measured here they also carry
   * the EXIF orientation correction, which a browser's `naturalWidth` does not.
   *
   * Falls back to what the client sent when the object cannot be measured: a
   * storage blip must not stop an upload appearing in the library, and the
   * browser's figure is usually right even though it is never trustworthy. An
   * image placed at the wrong aspect is the bug that made photos square before
   * the editor read their real size, so no number at all is the worst outcome.
   */
  async create(accountId: string, dto: CreateDesignAssetDto): Promise<DesignAsset> {
    const measured = await this.measure(dto.url);

    return this.prisma.designAsset.create({
      data: {
        accountId,
        url: dto.url,
        fileName: dto.fileName,
        width: measured?.width ?? dto.width ?? null,
        height: measured?.height ?? dto.height ?? null,
      },
      select: { id: true, url: true, fileName: true, width: true, height: true, createdAt: true },
    });
  }

  /** Our own storage only — the url arrives in a request body. */
  private measure(url: string): Promise<{ width: number; height: number } | null> {
    const supabaseUrl = this.config.get("SUPABASE_URL", { infer: true });
    const allowedHosts = [hostOf(supabaseUrl)].filter((host): host is string => host !== null);
    return measureAsset(url, { allowedHosts, label: "design asset", logger: this.logger });
  }

  /** Removes the library entry (account-scoped). Storage is left untouched so
   * designs already using the url keep rendering. */
  async remove(accountId: string, id: string): Promise<void> {
    // Scope accountId into the mutating query itself so one account can't delete
    // another's asset by id.
    const { count } = await this.prisma.designAsset.deleteMany({ where: { id, accountId } });
    if (count === 0) {
      throw new NotFoundException("Asset not found");
    }
  }
}
