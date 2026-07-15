import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface RecordAuditEntryInput {
  accountId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Records who accessed/exported recipient (children's) personal data — a
 * UK GDPR non-negotiable. Deliberately not fire-and-forget: a failed audit
 * write throws, so a silently lost compliance record can't happen.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEntryInput): Promise<void> {
    await this.prisma.auditLogEntry.create({ data: input });
  }
}
