import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MessagePageVideoProvider, MessagePageVideoType, Prisma } from "@prisma/client";
import {
  parseVideoEmbed,
  type MessagePageDetail,
  type MessagePageSummary,
} from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { generateSlug } from "../common/generate-slug";
import { sanitizeMessageHtml } from "../common/sanitize-message-html";
import type { CreateMessagePageDto } from "./dto/create-message-page.dto";
import type { UpdateMessagePageDto } from "./dto/update-message-page.dto";

/** The links each read needs to roll up per-card analytics + pick a primary QR. */
const PAGE_INCLUDE = {
  links: {
    select: { slug: true, viewCount: true, orderRecipientId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.MessagePageInclude;

type PagePayload = Prisma.MessagePageGetPayload<{ include: typeof PAGE_INCLUDE }>;

interface ResolvedVideo {
  videoType: MessagePageVideoType;
  videoUrl: string | null;
  videoProvider: MessagePageVideoProvider | null;
}

/**
 * The account-owned Message Pages library (ADR 0132). Authors reusable/bespoke
 * page *content*; every page is minted with a standalone QR link so it's
 * scannable the moment it's saved (the WordPress "give me a QR" behaviour),
 * while the send flow later mints per-card links onto the same page. Distinct
 * from `MessagesService`, which owns the public read + the v1 per-card
 * personalise surface.
 */
@Injectable()
export class MessagePagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Authoring is a paid-plan feature. Reads (list/get) stay open so a
   * downgraded account can still see and clean up pages it already made. */
  private async assertEnabled(accountId: string): Promise<void> {
    const entitlement = await this.entitlements.getForAccount(accountId);
    if (!entitlement.messagePagesEnabled) {
      throw new ForbiddenException(
        "Message pages are available on the Pro, Centre and Enterprise plans",
      );
    }
  }

  /** Turn a pasted URL into stored video fields, rejecting anything not on the
   * embed allowlist. `null`/empty clears the video. */
  private resolveVideo(videoUrl: string | null | undefined): ResolvedVideo {
    if (!videoUrl) {
      return { videoType: MessagePageVideoType.none, videoUrl: null, videoProvider: null };
    }
    const embed = parseVideoEmbed(videoUrl);
    if (!embed) {
      throw new BadRequestException(
        "That video link isn't from a supported provider (YouTube, Vimeo, Loom or Google Drive)",
      );
    }
    return {
      videoType: MessagePageVideoType.embed,
      videoUrl,
      videoProvider: embed.provider,
    };
  }

  /** A CTA is all-or-nothing: a button needs both a label and an https link. */
  private assertCtaCoherent(label: string | null, url: string | null): void {
    if (Boolean(label) !== Boolean(url)) {
      throw new BadRequestException(
        "A call-to-action needs both a button label and an https link",
      );
    }
  }

  private cleanMessage(message: string | null | undefined): string | null {
    if (!message) return null;
    const cleaned = sanitizeMessageHtml(message);
    return cleaned.length > 0 ? cleaned : null;
  }

  async create(
    accountId: string,
    userId: string,
    dto: CreateMessagePageDto,
  ): Promise<MessagePageDetail> {
    await this.assertEnabled(accountId);

    const video = this.resolveVideo(dto.videoUrl);
    const ctaLabel = dto.ctaLabel ?? null;
    const ctaUrl = dto.ctaUrl ?? null;
    this.assertCtaCoherent(ctaLabel, ctaUrl);

    const page = await this.prisma.$transaction(async (tx) => {
      const created = await tx.messagePage.create({
        data: {
          accountId,
          createdByUserId: userId,
          title: dto.title,
          message: this.cleanMessage(dto.message),
          emoji: dto.emoji ?? null,
          videoType: video.videoType,
          videoUrl: video.videoUrl,
          videoProvider: video.videoProvider,
          ctaLabel,
          ctaUrl,
          allowReplies: dto.allowReplies ?? false,
          recipientName: dto.recipientName ?? null,
        },
      });
      // Mint a standalone QR immediately so the page is usable on its own,
      // before it's ever attached to a card (orderRecipientId stays null).
      await tx.messagePageLink.create({
        data: { slug: generateSlug(), messagePageId: created.id },
      });
      return tx.messagePage.findUniqueOrThrow({
        where: { id: created.id },
        include: PAGE_INCLUDE,
      });
    });

    return toDetail(page);
  }

  async list(accountId: string): Promise<MessagePageSummary[]> {
    const pages = await this.prisma.messagePage.findMany({
      where: { accountId },
      include: PAGE_INCLUDE,
      orderBy: { updatedAt: "desc" },
    });
    return pages.map(toSummary);
  }

  async get(accountId: string, id: string): Promise<MessagePageDetail> {
    const page = await this.prisma.messagePage.findFirst({
      where: { id, accountId },
      include: PAGE_INCLUDE,
    });
    if (!page) {
      throw new NotFoundException("Message page not found");
    }
    return toDetail(page);
  }

  async update(
    accountId: string,
    id: string,
    dto: UpdateMessagePageDto,
  ): Promise<MessagePageDetail> {
    await this.assertEnabled(accountId);

    const existing = await this.prisma.messagePage.findFirst({
      where: { id, accountId },
      select: { id: true, ctaLabel: true, ctaUrl: true },
    });
    if (!existing) {
      throw new NotFoundException("Message page not found");
    }

    const data: Prisma.MessagePageUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.message !== undefined) data.message = this.cleanMessage(dto.message);
    if (dto.emoji !== undefined) data.emoji = dto.emoji;
    if (dto.allowReplies !== undefined) data.allowReplies = dto.allowReplies;
    if (dto.recipientName !== undefined) data.recipientName = dto.recipientName;
    if (dto.status !== undefined) data.status = dto.status;

    if (dto.videoUrl !== undefined) {
      const video = this.resolveVideo(dto.videoUrl);
      data.videoType = video.videoType;
      data.videoUrl = video.videoUrl;
      data.videoProvider = video.videoProvider;
    }

    // Validate the CTA against its state *after* this patch, so clearing one
    // half and leaving the other set is caught.
    const nextCtaLabel = dto.ctaLabel !== undefined ? (dto.ctaLabel ?? null) : existing.ctaLabel;
    const nextCtaUrl = dto.ctaUrl !== undefined ? (dto.ctaUrl ?? null) : existing.ctaUrl;
    if (dto.ctaLabel !== undefined || dto.ctaUrl !== undefined) {
      this.assertCtaCoherent(nextCtaLabel, nextCtaUrl);
      if (dto.ctaLabel !== undefined) data.ctaLabel = dto.ctaLabel;
      if (dto.ctaUrl !== undefined) data.ctaUrl = dto.ctaUrl;
    }

    const page = await this.prisma.messagePage.update({
      where: { id },
      data,
      include: PAGE_INCLUDE,
    });
    return toDetail(page);
  }

  /** Soft-delete: archived pages vanish from the library's default view but any
   * printed QR still resolves (degrading gracefully), so cards in the post never
   * break. Reads stay open; a page can be restored via update(status: active). */
  async archive(accountId: string, id: string): Promise<void> {
    const { count } = await this.prisma.messagePage.updateMany({
      where: { id, accountId },
      data: { status: "archived" },
    });
    if (count === 0) {
      throw new NotFoundException("Message page not found");
    }
  }
}

/** The page's own standalone QR (a link with no order recipient), else its
 * earliest link — what the library previews and offers to download. */
function primarySlug(links: PagePayload["links"]): string | null {
  const standalone = links.find((link) => link.orderRecipientId === null);
  return (standalone ?? links[0])?.slug ?? null;
}

function toSummary(page: PagePayload): MessagePageSummary {
  return {
    id: page.id,
    title: page.title,
    emoji: page.emoji,
    status: page.status,
    videoType: page.videoType,
    videoProvider: page.videoProvider,
    hasMessage: page.message !== null && page.message.length > 0,
    hasCta: page.ctaLabel !== null && page.ctaUrl !== null,
    allowReplies: page.allowReplies,
    primarySlug: primarySlug(page.links),
    linkCount: page.links.length,
    totalViews: page.links.reduce((sum, link) => sum + link.viewCount, 0),
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function toDetail(page: PagePayload): MessagePageDetail {
  // Re-derive the iframe src from the stored URL so the embed helper stays the
  // single source of truth; only embeds have one (uploads play via <video>).
  const embedUrl =
    page.videoType === MessagePageVideoType.embed && page.videoUrl
      ? (parseVideoEmbed(page.videoUrl)?.embedUrl ?? null)
      : null;
  return {
    ...toSummary(page),
    message: page.message,
    videoUrl: page.videoUrl,
    embedUrl,
    ctaLabel: page.ctaLabel,
    ctaUrl: page.ctaUrl,
    recipientName: page.recipientName,
  };
}
