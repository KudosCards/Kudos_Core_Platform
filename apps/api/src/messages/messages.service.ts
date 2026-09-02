import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MessagePageVideoProvider, MessagePageVideoType, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { parseVideoEmbed } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { renderBrandedEmail, escapeHtml } from "../email/email-layout";
import type { EnvConfig } from "../config/env.schema";
import { generateSlug } from "../common/generate-slug";
import { cleanMessageHtml } from "../common/sanitize-message-html";
import { MessagePageEventsService } from "./message-page-events.service";
import type { UpdateMessagePageDto } from "./dto/update-message-page.dto";
import type { SubmitMessageReplyDto } from "./dto/submit-message-reply.dto";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Reads the design document's default video URL (set in the card designer),
 * defensively — the document is stored as free-form JSON. */
function defaultVideoUrl(document: Prisma.JsonValue | null | undefined): string | null {
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const value = (document as Record<string, unknown>).videoUrl;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

interface ResolvedSeededVideo {
  videoType: MessagePageVideoType;
  videoUrl: string | null;
  videoProvider: MessagePageVideoProvider | null;
}

/** Classify the design's seeded video the same way the library builder does
 * (ADR 0132): an embeddable provider URL (YouTube / Vimeo / Loom / Google
 * Drive — which is exactly what the card designer's "Video link" field
 * collects) becomes an `embed` so the public page renders it in an iframe;
 * any other non-empty URL is kept as a legacy direct `upload`; empty clears it.
 * Without this an embed link is stored as `upload` and the public page tries to
 * play it through a raw <video> tag that can't render a YouTube/Vimeo page — the
 * exact v1 weakness v2 set out to fix. */
function resolveSeededVideo(document: Prisma.JsonValue | null | undefined): ResolvedSeededVideo {
  const url = defaultVideoUrl(document);
  if (!url) {
    return { videoType: MessagePageVideoType.none, videoUrl: null, videoProvider: null };
  }
  const embed = parseVideoEmbed(url);
  if (embed) {
    return {
      videoType: MessagePageVideoType.embed,
      videoUrl: url,
      videoProvider: embed.provider,
    };
  }
  return { videoType: MessagePageVideoType.upload, videoUrl: url, videoProvider: null };
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
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: NotificationInboxService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly events: MessagePageEventsService,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
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

    // Each card's page is decided upstream at order creation, not re-derived
    // here: the send composers carry the sender's explicit choice, and auto-send
    // resolves the design's linked page itself (ADR 0137). Settlement therefore
    // honours the order line's `messagePageId` verbatim — an empty one means the
    // sender chose "no page" and gets a fresh auto-page, never a silently
    // re-attached design page. (An explicit id was already re-validated active +
    // owned at order creation — batch-orders.create / auto-send — so it needs no
    // re-check here.)
    const effectivePageId = (recipient: (typeof pending)[number]): string | null =>
      recipient.messagePageId ?? null;

    // Cards with no chosen page get a fresh one. Mint page ids up-front so the
    // pages and their links can each be written in one bulk statement
    // (createMany can't return ids), keeping this to two writes for the batch.
    const autoRows = pending
      .filter((recipient) => !effectivePageId(recipient))
      .map((recipient) => {
        // `savedDesign` is optional-chained: the settlement path always sets a
        // design, but a missing one must never throw inside this transaction and
        // strand a paid order — it just yields a page with no video.
        const video = resolveSeededVideo(recipient.savedDesign?.document);
        return {
          pageId: randomUUID(),
          accountId: recipient.batchOrder.accountId,
          videoUrl: video.videoUrl,
          videoType: video.videoType,
          videoProvider: video.videoProvider,
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
          videoProvider: row.videoProvider,
        })),
      });
    }

    // One link per card: onto its fresh auto-page, or onto the chosen page
    // (explicit send-time choice or the validated design-linked page).
    const linkData = [
      ...autoRows.map((row) => ({
        slug: generateSlug(),
        messagePageId: row.pageId,
        orderRecipientId: row.orderRecipientId,
      })),
      ...pending
        .map((recipient) => ({ recipient, pageId: effectivePageId(recipient) }))
        .filter(
          (entry): entry is { recipient: (typeof pending)[number]; pageId: string } =>
            entry.pageId !== null,
        )
        .map((entry) => ({
          slug: generateSlug(),
          messagePageId: entry.pageId,
          orderRecipientId: entry.recipient.id,
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
        firstViewedAt: true,
        messagePage: {
          select: {
            id: true,
            accountId: true,
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

    // The counter and the time-series event (ADR 0136) are both analytics, not
    // the payload — the content is already resolved. They're independent writes,
    // so we issue them CONCURRENTLY to keep the added latency on this public path
    // to a single round-trip; each swallows its own failure so neither can deny a
    // recipient the message their card points them to. `events.record` is a
    // no-op unless MESSAGE_EVENTS_ENABLED and never throws.
    await Promise.all([
      this.prisma.messagePageLink
        .update({
          where: { id: link.id },
          data: {
            viewCount: { increment: 1 },
            // Stamp the first open so insights can show "first viewed" (Phase 3).
            ...(link.firstViewedAt === null ? { firstViewedAt: new Date() } : {}),
          },
        })
        .catch((error: unknown) => {
          this.logger.error(`View-count update failed for link ${link.id}: ${reasonOf(error)}`);
        }),
      this.events.record("viewed", {
        messagePageLinkId: link.id,
        messagePageId: page.id,
        accountId: page.accountId,
      }),
    ]);

    // Re-derive the iframe src from the stored URL so the embed helper stays the
    // single source of truth; a legacy upload keeps its direct file URL instead.
    const embedUrl =
      page.videoType === MessagePageVideoType.embed && page.videoUrl
        ? (parseVideoEmbed(page.videoUrl)?.embedUrl ?? null)
        : null;
    return {
      available: true,
      title: page.title,
      // Cleaned on the way out as well as in. The write-side fix cannot reach a
      // row already written by the unsanitised path, and there is no migration
      // that can (sanitising is not expressible in SQL), so every read that can
      // reach a raw-HTML sink does it too.
      //
      // This comment used to say "the only place this HTML is ever executed",
      // which was the reasoning rather than the fact: the authenticated builder
      // renders the same column through dangerouslySetInnerHTML and innerHTML,
      // and its read was left raw for a week on the strength of that sentence.
      // See ADR 0224.
      //
      // Idempotent, so a row cleaned at write time is unchanged here.
      message: cleanMessageHtml(page.message),
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

    await this.events.record("replied", {
      messagePageLinkId: link.id,
      messagePageId: link.messagePage.id,
      accountId: link.messagePage.accountId,
    });

    // Notifications are side effects — a failure to notify must never fail the
    // public reply itself (it's already stored), so each is logged and swallowed.
    const who = senderName ?? link.orderRecipient?.recipient.firstName ?? "Someone";
    try {
      await this.inbox.notifyAccount(link.messagePage.accountId, {
        kind: "message_reply",
        title: "New message reply",
        body: `${who} replied to “${link.messagePage.title}”`,
        href: `/message-pages/${link.messagePage.id}`,
        entityType: "message_page_reply",
        entityId: reply.id,
      });
    } catch (error) {
      this.logger.error(
        `Reply inbox notify failed for page ${link.messagePage.id}: ${reasonOf(error)}`,
      );
    }
    await this.notifyReplyEmail(
      link.messagePage.accountId,
      link.messagePage.id,
      link.messagePage.title,
      who,
      dto.body.trim(),
    );
  }

  /** Emails the account's contact that a reply arrived, linking to the page.
   * Best-effort: a send failure is logged, never surfaced to the public poster. */
  private async notifyReplyEmail(
    accountId: string,
    pageId: string,
    pageTitle: string,
    who: string,
    body: string,
  ): Promise<void> {
    try {
      const to = await this.resolveAccountEmail(accountId);
      if (!to) {
        return;
      }
      const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
      const pageUrl = `${webAppUrl}/message-pages/${pageId}`;
      await this.email.sendTransactional({
        to,
        subject: `New reply to “${pageTitle}”`,
        html: renderBrandedEmail({
          webAppUrl,
          preheader: `${who} replied to your message page.`,
          heading: "You've got a reply 💬",
          bodyHtml: `
            <p style="margin:0 0 16px"><strong>${escapeHtml(who)}</strong> replied to your
              message page <strong>${escapeHtml(pageTitle)}</strong>:</p>
            <p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(body)}</p>`,
          cta: { url: pageUrl, label: "View replies" },
        }),
      });
    } catch (error) {
      this.logger.error(`Reply email failed for page ${pageId}: ${reasonOf(error)}`);
    }
  }

  /** The account's contact email, else the owner's, else any member's — mirrors
   * SupportService / ReturnsService. */
  private async resolveAccountEmail(accountId: string): Promise<string | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { contactEmail: true },
    });
    if (account?.contactEmail) {
      return account.contactEmail;
    }
    const members = await this.prisma.membership.findMany({
      where: { accountId, email: { not: null } },
      select: { email: true, role: true },
    });
    return members.find((m) => m.role === "owner")?.email ?? members[0]?.email ?? null;
  }

  /**
   * Public CTA click (Phase 2, ADR 0132). Atomically counts the click on the
   * scanned link and returns the page's https CTA to redirect to. The public
   * button routes through here so a shared page still tracks per-card clicks. An
   * unknown slug, archived page, or a page with no CTA 404s.
   */
  async trackCtaClick(slug: string): Promise<string> {
    const link = await this.prisma.messagePageLink.findUnique({
      where: { slug },
      select: {
        id: true,
        messagePage: { select: { id: true, accountId: true, status: true, ctaUrl: true } },
      },
    });
    if (!link || link.messagePage.status === "archived" || !link.messagePage.ctaUrl) {
      throw new NotFoundException("Message page not found");
    }
    // Count the click and record the event concurrently (one round-trip of added
    // latency, not two) before redirecting. The counter update keeps its
    // throw-on-failure behaviour; `events.record` never throws.
    await Promise.all([
      this.prisma.messagePageLink.update({
        where: { id: link.id },
        data: { ctaClickCount: { increment: 1 } },
      }),
      this.events.record("cta_clicked", {
        messagePageLinkId: link.id,
        messagePageId: link.messagePage.id,
        accountId: link.messagePage.accountId,
      }),
    ]);
    return link.messagePage.ctaUrl;
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
        // Sanitised on the way in, exactly like PATCH /message-pages/:id. This
        // body is rendered as HTML on the public, unauthenticated card page, so
        // the audience for anything that gets through is not the author — it is
        // every recipient who scans a printed card. See ADR 0181.
        ...(dto.message !== undefined && { message: cleanMessageHtml(dto.message) }),
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
