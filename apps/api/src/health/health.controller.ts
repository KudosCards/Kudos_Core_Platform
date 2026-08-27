import { Controller, Get, NotFoundException, Req } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { PrismaService } from "../prisma/prisma.service";
import { Public } from "../auth/public.decorator";
import type { EnvConfig } from "../config/env.schema";

/** The subset of the Express request the IP diagnostic reads. */
interface RequestIpInfo {
  ip?: string;
  ips?: string[];
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
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
  /**
   * IP-resolution diagnostic — shows exactly how Express resolved the caller's
   * IP given the current `trust proxy` setting (TRUST_PROXY_HOPS). Use it to
   * confirm that value is correct AND safe for the real deployment topology
   * before relying on the per-IP rate limiting keyed on it (ADR 0133):
   *
   *   curl https://<api>/health/ip
   *     → `resolvedIp` should be YOUR public IP.
   *   curl https://<api>/health/ip -H 'X-Forwarded-For: 203.0.113.99'
   *     → `resolvedIp` should STILL be your real IP, NOT 203.0.113.99. If the
   *       injected value wins, TRUST_PROXY_HOPS is too high and the rate limit
   *       is spoofable — lower it by one and re-test.
   *
   * OFF by default — returns 404 unless IP_DIAGNOSTIC_ENABLED is "true"/"1", so
   * it isn't a standing endpoint. Flip it on to re-verify after any edge/proxy
   * change, then off again. Exposes only the caller's own forwarding info plus
   * the configured hop count (no secrets).
   */
  @Public()
  @Get("ip")
  ip(@Req() req: RequestIpInfo): {
    resolvedIp: string | null;
    forwardedChain: string[];
    xForwardedForHeader: string | string[] | null;
    socketRemoteAddress: string | null;
    trustProxyHops: number;
  } {
    const enabled = this.config.get("IP_DIAGNOSTIC_ENABLED", { infer: true });
    if (enabled !== "true" && enabled !== "1") {
      throw new NotFoundException();
    }
    return {
      resolvedIp: req.ip ?? null,
      forwardedChain: req.ips ?? [],
      xForwardedForHeader: req.headers["x-forwarded-for"] ?? null,
      socketRemoteAddress: req.socket?.remoteAddress ?? null,
      trustProxyHops: this.config.get("TRUST_PROXY_HOPS", { infer: true }),
    };
  }

  @Public()
  @Get("ready")
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.prismaIndicator.pingCheck("database", this.prisma)]);
  }
}
