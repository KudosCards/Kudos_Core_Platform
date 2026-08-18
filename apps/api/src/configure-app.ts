import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import type { EnvConfig } from "./config/env.schema";
import { corsOriginChecker, parseCommaList } from "./config/cors";
import { ServerTimingInterceptor } from "./observability/server-timing.interceptor";
import { SentryExceptionFilter } from "./observability/sentry-exception.filter";
import { SerializationConflictFilter } from "./common/serialization-conflict.filter";

/**
 * Applied to every app instance — production (main.ts) and every e2e test
 * alike — so tests exercise the exact same request pipeline (validation,
 * CORS, security headers) that production runs, not a lookalike.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<EnvConfig, true>);

  // Trust exactly N proxy hops in front of us, so Express derives `req.ip` (and
  // therefore the ThrottlerGuard's per-IP rate-limit key on every public route)
  // from the X-Forwarded-For chain rather than the hosting edge proxy's own
  // socket address. A specific hop count — never `true` — so a client can't
  // spoof X-Forwarded-For to escape the limit. 0 disables it entirely (socket
  // IP, the pre-fix behaviour). See TRUST_PROXY_HOPS in env.schema.ts and
  // docs/adr/0133-trust-proxy-and-rate-limit-integrity.md.
  const trustProxyHops = config.get("TRUST_PROXY_HOPS", { infer: true });
  if (trustProxyHops > 0) {
    const expressApp = app.getHttpAdapter().getInstance() as {
      set(setting: string, value: unknown): void;
    };
    expressApp.set("trust proxy", trustProxyHops);
  }

  app.use(helmet());
  // gzip/brotli every response above the default 1KB threshold. The API's list
  // endpoints (recipients, orders, occasions) return JSON that compresses ~70-80%,
  // so this is the broadest single latency win. Response-side only — it never
  // touches req.rawBody, so Stripe webhook signature verification is unaffected.
  app.use(compression());
  // CORS allow-list: the canonical WEB_APP_URL plus any extra origins/suffixes.
  // A configurable list (not a single origin) means a wrong value can't lock the
  // whole app out of the API — see ADR 0081.
  const allowedOrigins = [
    config.get("WEB_APP_URL", { infer: true }),
    ...parseCommaList(config.get("CORS_ALLOWED_ORIGINS", { infer: true })),
  ];
  const allowedOriginSuffixes = parseCommaList(
    config.get("CORS_ALLOWED_ORIGIN_SUFFIXES", { infer: true }),
  );
  app.enableCors({
    origin: corsOriginChecker(allowedOrigins, allowedOriginSuffixes),
    credentials: true,
    // Let browser-side callers (clientApiFetch) read the API timing header, and
    // the Retry-After that comes with a serialization conflict.
    exposedHeaders: ["Server-Timing", "Retry-After"],
  });
  // Stamps each response with `Server-Timing: app;dur=<ms>` — the measurement
  // baseline for the performance work (Phase 0). See the interceptor for detail.
  app.useGlobalInterceptors(new ServerTimingInterceptor());
  // Exception filters, in one place and one call because their **order matters
  // and is counter-intuitive**: Nest reverses the global filter list, so the
  // last one registered is the first one offered an exception. SentryExceptionFilter
  // is a `@Catch()` catch-all, so anything more specific must come after it here
  // or it never runs. Registered in configureApp rather than main.ts so the e2e
  // suite exercises the same chain production does — a filter that only takes
  // effect in one of the two renders a different response in the other, which is
  // precisely how the Retry-After header below went missing the first time.
  app.useGlobalFilters(
    new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter),
    new SerializationConflictFilter(),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (config.get("NODE_ENV", { infer: true }) !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Kudos Cards API")
      .setDescription("Kudos Cards platform API")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("docs", app, document);
  }
}
