import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import type { EnvConfig } from "./config/env.schema";
import { ServerTimingInterceptor } from "./observability/server-timing.interceptor";

/**
 * Applied to every app instance — production (main.ts) and every e2e test
 * alike — so tests exercise the exact same request pipeline (validation,
 * CORS, security headers) that production runs, not a lookalike.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<EnvConfig, true>);

  app.use(helmet());
  // gzip/brotli every response above the default 1KB threshold. The API's list
  // endpoints (recipients, orders, occasions) return JSON that compresses ~70-80%,
  // so this is the broadest single latency win. Response-side only — it never
  // touches req.rawBody, so Stripe webhook signature verification is unaffected.
  app.use(compression());
  app.enableCors({
    origin: config.get("WEB_APP_URL", { infer: true }),
    credentials: true,
    // Let browser-side callers (clientApiFetch) read the API timing header.
    exposedHeaders: ["Server-Timing"],
  });
  // Stamps each response with `Server-Timing: app;dur=<ms>` — the measurement
  // baseline for the performance work (Phase 0). See the interceptor for detail.
  app.useGlobalInterceptors(new ServerTimingInterceptor());
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
