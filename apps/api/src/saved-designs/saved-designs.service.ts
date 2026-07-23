import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type SavedDesign } from "@prisma/client";
import { designDocumentSchema } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { CardDesignsService } from "../card-designs/card-designs.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import type { CreateSavedDesignDto } from "./dto/create-saved-design.dto";
import type { UpdateSavedDesignDto } from "./dto/update-saved-design.dto";

const FOREIGN_KEY_VIOLATION = "P2003";

/**
 * Not audit-logged like RecipientsService — SavedDesign is card-layout
 * content (text/image positions, merge tokens), not recipient personal
 * data, so it isn't in scope for the GDPR audit trail AuditService exists for.
 */
@Injectable()
export class SavedDesignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardDesigns: CardDesignsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(accountId: string, dto: CreateSavedDesignDto): Promise<SavedDesign> {
    // Two ways to make a saved design:
    //  1. From a catalog template — copy its document (or an edited variant).
    //  2. From the member's own uploaded artwork — no template, so a document
    //     is required, and the plan must carry the customArtworkEnabled gate.
    if (dto.cardDesignId) {
      const template = await this.cardDesigns.findOne(dto.cardDesignId);
      const document = dto.document ? this.parseDocument(dto.document) : template.document;
      return this.prisma.savedDesign.create({
        data: {
          accountId,
          cardDesignId: template.id,
          name: dto.name,
          document: document as Prisma.InputJsonValue,
        },
      });
    }

    if (!dto.document) {
      throw new BadRequestException(
        "A document is required when creating a design without a template",
      );
    }
    const entitlement = await this.entitlements.getForAccount(accountId);
    if (!entitlement.customArtworkEnabled) {
      throw new ForbiddenException(
        "Uploading your own artwork is available on the Pro and Centre plans",
      );
    }
    const document = this.parseDocument(dto.document);
    return this.prisma.savedDesign.create({
      data: {
        accountId,
        cardDesignId: null,
        name: dto.name,
        document: document as Prisma.InputJsonValue,
      },
    });
  }

  list(accountId: string): Promise<SavedDesign[]> {
    return this.prisma.savedDesign.findMany({
      where: { accountId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(accountId: string, id: string): Promise<SavedDesign> {
    const design = await this.prisma.savedDesign.findFirst({ where: { id, accountId } });
    if (!design) {
      throw new NotFoundException("Saved design not found");
    }
    return design;
  }

  async update(accountId: string, id: string, dto: UpdateSavedDesignDto): Promise<SavedDesign> {
    const document = dto.document ? this.parseDocument(dto.document) : undefined;

    const { count } = await this.prisma.savedDesign.updateMany({
      where: { id, accountId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(document && { document: document as Prisma.InputJsonValue }),
      },
    });
    if (count === 0) {
      throw new NotFoundException("Saved design not found");
    }

    return this.prisma.savedDesign.findFirstOrThrow({ where: { id, accountId } });
  }

  async remove(accountId: string, id: string): Promise<void> {
    try {
      const { count } = await this.prisma.savedDesign.deleteMany({ where: { id, accountId } });
      if (count === 0) {
        throw new NotFoundException("Saved design not found");
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new ConflictException(
          "This design is attached to an approved occasion and can't be deleted",
        );
      }
      throw error;
    }
  }

  private parseDocument(document: Record<string, unknown>): Record<string, unknown> {
    const result = designDocumentSchema.safeParse(document);
    if (!result.success) {
      throw new BadRequestException(
        `Invalid design document: ${result.error.issues.map((issue) => issue.message).join(", ")}`,
      );
    }
    return result.data;
  }
}
