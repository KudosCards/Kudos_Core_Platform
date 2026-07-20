import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { generateSlug } from "../common/generate-slug";
import type { UpdateMessagePageDto } from "./dto/update-message-page.dto";

const RECORD_NOT_FOUND = "P2025";

/** Reads the design document's default video URL (set in the card designer),
 * defensively — the document is stored as free-form JSON. */
function defaultVideoUrl(document: Prisma.JsonValue): string | null {
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const value = (document as Record<string, unknown>).videoUrl;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/** The public, unauthenticated view — deliberately narrow. Exposes only what a
 * card recipient needs to see their own message, plus their first name for a
 * personal greeting (the same name already handwritten on the physical card
 * posted to them). No account, order, address, or view-count data leaks here. */
export interface PublicMessagePage {
  message: string | null;
  emoji: string | null;
  videoUrl: string | null;
  recipientFirstName: string;
  occasionType: string;
}

/** The account-facing shape used by the "personalise your cards" screen. */
export type AccountMessagePage = Prisma.MessagePageGetPayload<{
  select: {
    id: true;
    slug: true;
    message: true;
    emoji: true;
    videoUrl: true;
    viewCount: true;
    orderRecipient: {
      select: {
        recipient: { select: { firstName: true; lastName: true } };
        occasion: { select: { type: true } };
      };
    };
  };
}>;

const ACCOUNT_MESSAGE_PAGE_SELECT = {
  id: true,
  slug: true,
  message: true,
  emoji: true,
  videoUrl: true,
  viewCount: true,
  orderRecipient: {
    select: {
      recipient: { select: { firstName: true, lastName: true } },
      occasion: { select: { type: true } },
    },
  },
} satisfies Prisma.MessagePageSelect;

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a MessagePage (content empty) for each of the given order
   * recipients, generating a unique slug per row. Called from the payment
   * webhook right after a batch order is paid — every printed card gets a
   * working QR target from the moment it enters production, whether or not
   * the message has been written yet. Uses skipDuplicates so a redelivered
   * webhook can't create a second page for the same OrderRecipient (which
   * its @unique orderRecipientId would reject anyway).
   */
  async createForOrderRecipients(
    tx: Prisma.TransactionClient,
    orderRecipientIds: string[],
  ): Promise<void> {
    if (orderRecipientIds.length === 0) {
      return;
    }
    // Load each recipient's saved design so the page can be seeded with the
    // design's default video (the QR then works from the first scan). The
    // subscriber can still personalise or change it per recipient on /messages.
    const recipients = await tx.orderRecipient.findMany({
      where: { id: { in: orderRecipientIds } },
      select: { id: true, savedDesign: { select: { document: true } } },
    });
    await tx.messagePage.createMany({
      data: recipients.map((recipient) => ({
        orderRecipientId: recipient.id,
        slug: generateSlug(),
        videoUrl: defaultVideoUrl(recipient.savedDesign.document),
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Public read — atomically increments viewCount in the same statement that
   * fetches the page (Prisma's `{ increment: 1 }` compiles to a single
   * `UPDATE ... SET view_count = view_count + 1`, so no read-then-write race).
   */
  async viewBySlug(slug: string): Promise<PublicMessagePage> {
    try {
      const page = await this.prisma.messagePage.update({
        where: { slug },
        data: { viewCount: { increment: 1 } },
        select: {
          message: true,
          emoji: true,
          videoUrl: true,
          orderRecipient: {
            select: {
              recipient: { select: { firstName: true } },
              occasion: { select: { type: true } },
            },
          },
        },
      });
      return {
        message: page.message,
        emoji: page.emoji,
        videoUrl: page.videoUrl,
        recipientFirstName: page.orderRecipient.recipient.firstName,
        occasionType: page.orderRecipient.occasion?.type ?? "bespoke_campaign",
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        throw new NotFoundException("Message page not found");
      }
      throw error;
    }
  }

  list(accountId: string): Promise<AccountMessagePage[]> {
    return this.prisma.messagePage.findMany({
      where: { orderRecipient: { batchOrder: { accountId } } },
      select: ACCOUNT_MESSAGE_PAGE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async update(
    accountId: string,
    id: string,
    dto: UpdateMessagePageDto,
  ): Promise<AccountMessagePage> {
    // Scope the mutation itself through the ownership chain (message page ->
    // order recipient -> batch order -> account), not just a pre-check, so a
    // page belonging to another account can never be updated by id alone.
    const { count } = await this.prisma.messagePage.updateMany({
      where: { id, orderRecipient: { batchOrder: { accountId } } },
      data: {
        ...(dto.message !== undefined && { message: dto.message }),
        ...(dto.emoji !== undefined && { emoji: dto.emoji }),
        ...(dto.videoUrl !== undefined && { videoUrl: dto.videoUrl }),
      },
    });
    if (count === 0) {
      throw new NotFoundException("Message page not found");
    }

    return this.prisma.messagePage.findFirstOrThrow({
      where: { id },
      select: ACCOUNT_MESSAGE_PAGE_SELECT,
    });
  }
}
