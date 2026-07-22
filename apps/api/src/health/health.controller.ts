import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { PrismaService } from "../prisma/prisma.service";
import { Public } from "../auth/public.decorator";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Liveness — is the process up and serving? Deliberately has NO external
   * dependencies (no database ping): the platform's deploy/liveness healthcheck
   * must not fail — and get a healthy instance killed or a good deploy rejected —
   * over a transient database blip (e.g. a provider outbound-connectivity
   * incident). Point Railway's healthcheck at this route. Readiness (can it
   * actually reach the DB?) is /health/ready.
   */
  @Public()
  @Get()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /**
   * Readiness — can this instance serve database-backed traffic right now? Pings
   * the database. For load-balancer readiness probes and monitoring, NOT as the
   * deploy/liveness gate (see `live` above).
   */
  @Public()
  @Get("ready")
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.pingCheck("database", this.prisma),
    ]);
  }
}
