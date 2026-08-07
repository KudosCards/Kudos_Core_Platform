import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MessagePageVideoType, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { parseVideoEmbed } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { generateSlug } from "../common/generate-slug";
import type { UpdateMessagePageDto } from "./dto/update-message-page.dto";
import type { SubmitMessageReplyDto } from "./dto/submit-message-reply.dto";

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
 * posted to them). No account, order, address, or view-count data leaks here.
 *
 * v2 (ADR 0132) widens the content to the full page — title, an embeddable
 * video (`embedUrl` for the iframe, `videoUrl` for a legacy direct upload),
 * server-sanitised rich `message`, and an https CTA — while `available` lets an
 * archived page degrade to a graceful "no longer available" state rather than a
 * 404, so a card already in the post never dead-ends. */
export interface PublicMessagePage {
  available: boolean;
  title: string | null;
  message: string | null;
  emoji: string | null;
  videoType: MessagePageVideoType;
  /** The iframe src for an embed provider (null unless videoType === "embed"). */
  embedUrl: string | null;
  /** The direct file URL for a legacy upload (null unless videoType === "upload"). */
  videoUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  /** Whether this page invites the recipient to write back (Phase 2). */
  allowReplies: boolean;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: NotificationInboxService,
  ) {}

  /**
   * Mints each given order recipient's MessagePageLink (unique slug, bound to
   * the card) so every printed QR resolves from the moment the order enters
   * production. Called from the payment webhook right after a batch order is
   * paid. Two paths (ADR 0132):
   *  - a card that **chose a library page** in the send flow (`messagePageId`
   *    set) gets a link pointing at that shared page — its scans roll up as
   *    per-card analytics on the reused page;
   *  - a card with no chosen page gets a fresh auto-created page (title
   *    defaulted, seeded with the design's default video), preserving the
   *    original per-card behaviour and keeping the QR working even when nothing
   *    was written.
   * Idempotent: recipients that already have a link (a redelivered webhook /
   * retried transaction) are skipped, and the link's unique orderRecipientId
   * would reject a duplicate anyway.
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
          messagePageId: true,
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
    const pending = recipients.filter((recipient) => !alreadyLinked.has(recipient.id));
    if (pending.length === 0) {
      return;
    }

    // Cards with no chosen page get a fresh one. Mint page ids up-front so the
    // pages and their links can each be written in one bulk statement
    // (createMany can't return ids), keeping this to two writes for the batch.
    const autoRows = pending
      .filter((recipient) => !recipient.messagePageId)
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
    if (autoRows.length > 0) {
      await tx.messagePage.createMany({
        data: autoRows.map((row) => ({
          id: row.pageId,
          accountId: row.accountId,
          title: "Your message",
          videoUrl: row.videoUrl,
          videoType: row.videoType,
        })),
      });
    }

    // One link per card: onto its fresh auto-page, or onto the chosen library page.
    const linkData = [
      ...autoRows.map((row) => ({
        slug: generateSlug(),
        messagePageId: row.pageId,
        orderRecipientId: row.orderRecipientId,
      })),
      ...pending
        .filter((recipient) => recipient.messagePageId)
        .map((recipient) => ({
          slug: generateSlug(),
          messagePageId: recipient.messagePageId!,
          orderRecipientId: recipient.id,
        })),
    ];
    await tx.messagePageLink.createMany({
      data: linkData,
      skipDuplicates: true,
    });
  }

  /**
   * Public read. Resolves the link (404 if the slug is unknown) and returns the
   * linked page's content. A standalone link (no order recipient) falls back to
   * the page's manual `recipientName`.
   *
   * An **archived** page returns `available: false` and no content (a graceful
   * "no longer available" for a card already posted), and its view is NOT
   * counted. An active page's view is counted with an atomic
   * `{ increment: 1 }` — a single `UPDATE ... SET view_count = view_count + 1`,
   * so no read-then-write race. The status has to be known before we decide to
   * count, so the fetch and the increment are two statements here (this endpoint
   * is scan-rate, not hot-path).
   */
  async viewBySlug(slug: string): Promise<PublicMessagePage> {
    const link = await this.prisma.messagePageLink.findUnique({
      where: { slug },
      select: {
        id: true,
        messagePage: {
          select: {
            status: true,
            title: true,
            message: true,
            emoji: true,
            videoType: true,
            videoUrl: true,
            ctaLabel: true,
            ctaUrl: true,
            allowReplies: true,
            recipientName: true,
          },
        },
        orderRecipient: {
          select: {
            recipient: { select: { firstName: true } },
            occasion: { select: { type: true } },
          },
        },
      },
    });
    if (!link) {
      throw new NotFoundException("Message page not found");
    }

    const page = link.messagePage;
    const recipientFirstName =
      link.orderRecipient?.recipient.firstName ?? page.recipientName ?? "there";
    const occasionType = link.orderRecipient?.occasion?.type ?? "bespoke_campaign";

    if (page.status === "archived") {
      return {
        available: false,
        title: null,
        message: null,
        emoji: null,
        videoType: MessagePageVideoType.none,
        embedUrl: null,
        videoUrl: null,
        ctaLabel: null,
        ctaUrl: null,
        allowReplies: false,
        recipientFirstName,
        occasionType,
      };
    }

    await this.prisma.messagePageLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 } },
    });

    // Re-derive the iframe src from the stored URL so the embed helper stays the
    // single source of truth; a legacy upload keeps its direct file URL instead.
    const embedUrl =
      page.videoType === MessagePageVideoType.embed && page.videoUrl
        ? (parseVideoEmbed(page.videoUrl)?.embedUrl ?? null)
        : null;
    return {
      available: true,
      title: page.title,
      message: page.message,
      emoji: page.emoji,
      videoType: page.videoType,
      embedUrl,
      videoUrl: page.videoType === MessagePageVideoType.upload ? page.videoUrl : null,
      ctaLabel: page.ctaLabel,
      ctaUrl: page.ctaUrl,
      allowReplies: page.allowReplies,
      recipientFirstName,
      occasionType,
    };
  }

  /**
   * Public reply submission (Phase 2, ADR 0132). Anonymous, so it's throttled at
   * the controller and validated to a plain-text, length-capped body. Only a
   * live page that opted into replies accepts one; an unknown slug or archived
   * page 404s, a page with replies off 403s. On success it records the reply and
   * notifies the account's members (inbox), idempotent on the reply id.
   */
  async submitReply(slug: string, dto: SubmitMessageReplyDto): Promise<void> {
    const link = await this.prisma.messagePageLink.findUnique({
      where: { slug },
      select: {
        id: true,
        orderRecipient: { select: { recipient: { select: { firstName: true } } } },
        messagePage: {
          select: {
            id: true,
            accountId: true,
            title: true,
            status: true,
            allowReplies: true,
          },
        },
      },
    });
    if (!link || link.messagePage.status === "archived") {
      throw new NotFoundException("Message page not found");
    }
    if (!link.messagePage.allowReplies) {
      throw new ForbiddenException("This page isn't accepting replies");
    }

    const senderName = dto.senderName?.trim() || null;
    const reply = await this.prisma.messagePageReply.create({
      data: { messagePageLinkId: link.id, senderName, body: dto.body.trim() },
      select: { id: true },
    });

    const who = senderName ?? link.orderRecipient?.recipient.firstName ?? "Someone";
    await this.inbox.notifyAccount(link.messagePage.accountId, {
      kind: "message_reply",
      title: "New message reply",
      body: `${who} replied to “${link.messagePage.title}”`,
      href: `/message-pages/${link.messagePage.id}`,
      entityType: "message_page_reply",
      entityId: reply.id,
    });
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
