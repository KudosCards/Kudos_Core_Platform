import { Injectable, NotFoundException } from "@nestjs/common";
import { MessagePageVideoType, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
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

/** The account-facing row used by the "personalise your cards" screen — one per
 * card link, joining the page content. Structurally unchanged from v1 so that
 * surface is untouched by the page/link split; the richer builder + reuse arrive
 * in a later Message Pages v2 slice. See docs/adr/0132-message-pages-v2.md. */
export interface AccountMessagePage {
  id: string;
  slug: string;
  message: string | null;
  emoji: string | null;
  videoUrl: string | null;
  viewCount: number;
  orderRecipient: {
    recipient: { firstName: string; lastName: string };
    occasion: { type: string } | null;
  } | null;
}

/** The page + its (first) card link, in one query shape reused by list/update. */
const ACCOUNT_PAGE_SELECT = {
  id: true,
  message: true,
  emoji: true,
  videoUrl: true,
  links: {
    take: 1,
    orderBy: { createdAt: "asc" },
    select: {
      slug: true,
      viewCount: true,
      orderRecipient: {
        select: {
          recipient: { select: { firstName: true, lastName: true } },
          occasion: { select: { type: true } },
        },
      },
    },
  },
} satisfies Prisma.MessagePageSelect;

type AccountPagePayload = Prisma.MessagePageGetPayload<{ select: typeof ACCOUNT_PAGE_SELECT }>;

/** Flatten a page + its first link into the account row, or null if (somehow)
 * the page has no link yet. */
function toAccountMessagePage(page: AccountPagePayload): AccountMessagePage | null {
  const link = page.links[0];
  if (!link) return null;
  return {
    id: page.id,
    slug: link.slug,
    message: page.message,
    emoji: page.emoji,
    videoUrl: page.videoUrl,
    viewCount: link.viewCount,
    orderRecipient: link.orderRecipient,
  };
}

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a MessagePage (content empty, title defaulted) + a MessagePageLink
   * (unique slug, bound to the card) for each of the given order recipients.
   * Called from the payment webhook right after a batch order is paid — every
   * printed card gets a working QR target from the moment it enters production,
   * whether or not the message has been written yet. Idempotent: recipients that
   * already have a link (a redelivered webhook / retried transaction) are
   * skipped, and the link's unique orderRecipientId would reject a duplicate
   * anyway. (The send-flow slice will make this opt-in; auto-create preserves
   * today's behaviour meanwhile.) See docs/adr/0132-message-pages-v2.md.
   */
  async createForOrderRecipients(
    tx: Prisma.TransactionClient,
    orderRecipientIds: string[],
  ): Promise<void> {
    if (orderRecipientIds.length === 0) {
      return;
    }
    const [recipients, existing] = await Promise.all([
      tx.orderRecipient.findMany({
        where: { id: { in: orderRecipientIds } },
        select: {
          id: true,
          batchOrder: { select: { accountId: true } },
          savedDesign: { select: { document: true } },
        },
      }),
      tx.messagePageLink.findMany({
        where: { orderRecipientId: { in: orderRecipientIds } },
        select: { orderRecipientId: true },
      }),
    ]);
    const alreadyLinked = new Set(existing.map((link) => link.orderRecipientId));

    // Mint page ids up-front so the pages and their links can each be written in
    // one bulk statement (createMany can't return ids), keeping this to two
    // writes even for a large batch.
    const rows = recipients
      .filter((recipient) => !alreadyLinked.has(recipient.id))
      .map((recipient) => {
        const video = defaultVideoUrl(recipient.savedDesign.document);
        return {
          pageId: randomUUID(),
          accountId: recipient.batchOrder.accountId,
          videoUrl: video,
          videoType: video ? MessagePageVideoType.upload : MessagePageVideoType.none,
          orderRecipientId: recipient.id,
        };
      });
    if (rows.length === 0) {
      return;
    }

    await tx.messagePage.createMany({
      data: rows.map((row) => ({
        id: row.pageId,
        accountId: row.accountId,
        title: "Your message",
        videoUrl: row.videoUrl,
        videoType: row.videoType,
      })),
    });
    await tx.messagePageLink.createMany({
      data: rows.map((row) => ({
        slug: generateSlug(),
        messagePageId: row.pageId,
        orderRecipientId: row.orderRecipientId,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Public read — atomically increments the LINK's viewCount in the same
   * statement that fetches it (Prisma's `{ increment: 1 }` compiles to a single
   * `UPDATE ... SET view_count = view_count + 1`, so no read-then-write race),
   * then returns the linked page's content. A standalone link (no order
   * recipient) falls back to the page's manual `recipientName`.
   */
  async viewBySlug(slug: string): Promise<PublicMessagePage> {
    try {
      const link = await this.prisma.messagePageLink.update({
        where: { slug },
        data: { viewCount: { increment: 1 } },
        select: {
          messagePage: {
            select: { message: true, emoji: true, videoUrl: true, recipientName: true },
          },
          orderRecipient: {
            select: {
              recipient: { select: { firstName: true } },
              occasion: { select: { type: true } },
            },
          },
        },
      });
      return {
        message: link.messagePage.message,
        emoji: link.messagePage.emoji,
        videoUrl: link.messagePage.videoUrl,
        recipientFirstName:
          link.orderRecipient?.recipient.firstName ?? link.messagePage.recipientName ?? "there",
        occasionType: link.orderRecipient?.occasion?.type ?? "bespoke_campaign",
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

  async list(accountId: string): Promise<AccountMessagePage[]> {
    const pages = await this.prisma.messagePage.findMany({
      where: { accountId, status: "active" },
      select: ACCOUNT_PAGE_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return pages
      .map(toAccountMessagePage)
      .filter((page): page is AccountMessagePage => page !== null);
  }

  async update(
    accountId: string,
    id: string,
    dto: UpdateMessagePageDto,
  ): Promise<AccountMessagePage> {
    // Scope the mutation by the page's own accountId — the page/link split means
    // ownership no longer has to be chased through the order chain.
    const { count } = await this.prisma.messagePage.updateMany({
      where: { id, accountId },
      data: {
        ...(dto.message !== undefined && { message: dto.message }),
        ...(dto.emoji !== undefined && { emoji: dto.emoji }),
        ...(dto.videoUrl !== undefined && { videoUrl: dto.videoUrl }),
      },
    });
    if (count === 0) {
      throw new NotFoundException("Message page not found");
    }

    const page = await this.prisma.messagePage.findFirstOrThrow({
      where: { id },
      select: ACCOUNT_PAGE_SELECT,
    });
    const mapped = toAccountMessagePage(page);
    if (!mapped) {
      throw new NotFoundException("Message page not found");
    }
    return mapped;
  }
}
