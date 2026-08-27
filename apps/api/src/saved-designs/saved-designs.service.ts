import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type SavedDesign } from "@prisma/client";
import { designDocumentSchema, reservedFooterViolation } from "@kudos/shared-types";
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
      // A catalog template copied verbatim skips parseDocument, so check it here
      // too — otherwise a template with a badly placed back element would be the
      // one way to get an unprintable design into the library.
      const document = dto.document
        ? this.parseDocument(dto.document)
        : (this.assertPrintable(template.document as Record<string, unknown>), template.document);
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
    // Archived designs (soft-deleted but still referenced by order/occasion
    // history) never appear in the library.
    return this.prisma.savedDesign.findMany({
      where: { accountId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(accountId: string, id: string): Promise<SavedDesign> {
    const design = await this.prisma.savedDesign.findFirst({
      where: { id, accountId, archivedAt: null },
    });
    if (!design) {
      throw new NotFoundException("Saved design not found");
    }
    return design;
  }

  async update(accountId: string, id: string, dto: UpdateSavedDesignDto): Promise<SavedDesign> {
    const document = dto.document ? this.parseDocument(dto.document) : undefined;

    const { count } = await this.prisma.savedDesign.updateMany({
      where: { id, accountId, archivedAt: null },
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

  /**
   * "Delete" a saved design. If nothing references it, it's hard-deleted. If a
   * past order (OrderRecipient) or an approved occasion still points at it, the
   * row can't be removed without breaking that history — so it's archived out of
   * the library instead. Either way the design leaves "My designs"; the caller
   * learns which happened via the returned `archived` flag.
   */
  async remove(accountId: string, id: string): Promise<{ archived: boolean }> {
    // Confirm ownership (and that it isn't already archived) up front, so a
    // missing/foreign id is a clean 404 rather than a swallowed no-op.
    const existing = await this.prisma.savedDesign.findFirst({
      where: { id, accountId, archivedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Saved design not found");
    }

    try {
      await this.prisma.savedDesign.delete({ where: { id } });
      return { archived: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        // Still referenced by order/occasion history — soft-delete instead.
        await this.prisma.savedDesign.update({
          where: { id },
          data: { archivedAt: new Date() },
        });
        return { archived: true };
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
    this.assertPrintable(result.data);
    return result.data;
  }

  /**
   * Refuse to store a design whose back reaches into the reserved footer.
   *
   * This is the guardrail, and it is here rather than at checkout on purpose. A
   * design that cannot enter a bad state cannot be ordered in one — by *any*
   * route, including the two that create orders straight through Prisma and
   * never touch BatchOrdersService: unattended auto-send and returns reprints.
   * Guarding the checkout paths alone would have left both of those open.
   *
   * It also fails at the moment the customer can actually act on it, with the
   * design open in front of them, rather than at the payment screen after
   * they have picked a hundred recipients.
   *
   * Only *placed elements* block. A background covers the strip by nature and
   * simply stops at the line — see reservedFooterViolation.
   */
  private assertPrintable(document: Record<string, unknown>): void {
    const violation = reservedFooterViolation(
      document as unknown as {
        pages: { name: string; background?: unknown; elements: unknown[] }[];
      },
    );
    if (violation) {
      throw new BadRequestException(violation.message);
    }
  }
}
