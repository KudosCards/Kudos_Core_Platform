import { Injectable, NotFoundException } from "@nestjs/common";
import type { DesignAsset } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
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
  constructor(private readonly prisma: PrismaService) {}

  async list(accountId: string): Promise<DesignAsset[]> {
    return this.prisma.designAsset.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: { id: true, url: true, fileName: true, width: true, height: true, createdAt: true },
    });
  }

  async create(accountId: string, dto: CreateDesignAssetDto): Promise<DesignAsset> {
    return this.prisma.designAsset.create({
      data: {
        accountId,
        url: dto.url,
        fileName: dto.fileName,
        width: dto.width ?? null,
        height: dto.height ?? null,
      },
      select: { id: true, url: true, fileName: true, width: true, height: true, createdAt: true },
    });
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
