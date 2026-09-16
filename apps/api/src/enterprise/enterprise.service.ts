import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma, EnterpriseEnquiry as EnterpriseEnquiryRow } from "@prisma/client";
import type { EnterpriseEnquiry } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";
import type { Paginated } from "../common/paginated";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { renderBrandedEmail, escapeHtml } from "../email/email-layout";
import { CreateEnterpriseEnquiryDto } from "./dto/create-enterprise-enquiry.dto";
import { ListEnterpriseQueryDto } from "./dto/list-enterprise-query.dto";
import { classifyEnquiry } from "./spam-signals";

/** One row → the ops-facing view (drops the internal audit column). */
function toView(row: EnterpriseEnquiryRow): EnterpriseEnquiry {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    organisation: row.organisation,
    phone: row.phone,
    teamSize: row.teamSize,
    message: row.message,
    status: row.status,
    spamReason: row.spamReason,
    createdAt: row.createdAt,
  };
}

const DEFAULT_PER_PAGE = 50;

/**
 * Enterprise "Contact us" leads. A public submit persists the enquiry (so a
 * sales lead is never lost) and best-effort emails the ops inbox; ops then work
 * it from the admin queue. Enterprise isn't self-serve, so there's no plan
 * activation here — provisioning is a manual ops step. See
 * docs/adr/0101-enterprise-plan-enquiries.md.
 */
@Injectable()
export class EnterpriseService {
  private readonly logger = new Logger(EnterpriseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /**
   * Capture a public enquiry, then nudge ops. Empty optional strings → null.
   *
   * A submission the spam gate catches is still written — ADR 0101's promise is
   * that a sales lead is never lost — but it lands as `spam` with the rule that
   * caught it, and ops are not emailed. The caller cannot tell: same 201, same
   * ack shape, so a crawler gets no signal to tune against. See ADR 0244.
   */
  async create(dto: CreateEnterpriseEnquiryDto): Promise<EnterpriseEnquiry> {
    const spamReason = classifyEnquiry(dto, new Date());
    const enquiry = await this.prisma.enterpriseEnquiry.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.trim(),
        organisation: dto.organisation.trim(),
        phone: dto.phone?.trim() || null,
        teamSize: dto.teamSize?.trim() || null,
        message: dto.message.trim(),
        ...(spamReason && { status: "spam" as const, spamReason }),
      },
    });
    if (spamReason) {
      this.logger.log(`Enterprise enquiry ${enquiry.id} held as spam (${spamReason})`);
      return toView(enquiry);
    }
    await this.notifyOps(enquiry);
    return toView(enquiry);
  }

  /** The ops queue. Defaults to open leads, newest first.
   *
   * "Open" excludes `spam` as well as `closed`. Defining it as "not closed"
   * would pipe every caught bot straight into the view ops actually look at,
   * which is the exact outcome the gate exists to prevent. */
  async list(query: ListEnterpriseQueryDto): Promise<Paginated<EnterpriseEnquiry>> {
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(query.perPage) || DEFAULT_PER_PAGE));
    // Annotated rather than inferred: without a contextual type the ternary
    // widens the status list to string[], which Prisma's enum filter rejects.
    const where: Prisma.EnterpriseEnquiryWhereInput =
      !query.status || query.status === "open"
        ? { status: { notIn: ["closed", "spam"] } }
        : { status: query.status };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.enterpriseEnquiry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.enterpriseEnquiry.count({ where }),
    ]);
    return { items: rows.map(toView), total, page, perPage };
  }

  /** Ops moves a lead through triage (new → in_progress → closed), bins one the
   * spam gate missed, or restores one it shouldn't have caught (spam → new). */
  async updateStatus(
    adminUserId: string,
    id: string,
    status: "new" | "in_progress" | "closed" | "spam",
  ): Promise<EnterpriseEnquiry> {
    const existing = await this.prisma.enterpriseEnquiry.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Enquiry not found");
    }
    const updated = await this.prisma.enterpriseEnquiry.update({
      where: { id },
      data: { status, handledByUserId: adminUserId },
    });
    return toView(updated);
  }

  /** Best-effort email to the ops inbox — a missing SUPPORT_INBOX_EMAIL just
   * means no nudge; the lead is safely stored either way, so this never throws. */
  private async notifyOps(enquiry: EnterpriseEnquiryRow): Promise<void> {
    const to = this.config.get("SUPPORT_INBOX_EMAIL", { infer: true });
    if (!to) {
      return;
    }
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const opsUrl = `${webAppUrl}/admin/enterprise`;
    const rows: [string, string | null][] = [
      ["From", enquiry.name],
      ["Organisation", enquiry.organisation],
      ["Email", enquiry.email],
      ["Phone", enquiry.phone],
      ["Size", enquiry.teamSize],
    ];
    const detailHtml = rows
      .filter(([, value]) => value)
      .map(
        ([label, value]) =>
          `<p style="margin:0 0 4px"><strong>${label}:</strong> ${escapeHtml(String(value))}</p>`,
      )
      .join("");
    try {
      await this.email.sendTransactional({
        to,
        subject: `New Enterprise enquiry — ${enquiry.organisation}`,
        html: renderBrandedEmail({
          webAppUrl,
          preheader: `${enquiry.name} at ${enquiry.organisation} wants to talk Enterprise`,
          heading: "New Enterprise enquiry",
          bodyHtml: `
            ${detailHtml}
            <p style="margin:12px 0 4px"><strong>Message:</strong></p>
            <p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(enquiry.message)}</p>`,
          cta: { url: opsUrl, label: "Open Enterprise leads" },
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Enterprise enquiry email for ${enquiry.id} failed: ${reason}`);
    }
  }
}
