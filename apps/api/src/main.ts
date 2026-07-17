import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";
import type { EnvConfig } from "./config/env.schema";
import { initSentry } from "./observability/sentry";
import { SentryExceptionFilter } from "./observability/sentry-exception.filter";

async function bootstrap(): Promise<void> {
  // Before app creation so Sentry's instrumentation wraps everything. No-op
  // unless SENTRY_DSN is set (unchanged behaviour in dev/test).
  initSentry();

  // rawBody: true exposes req.rawBody (the exact bytes Stripe signed) alongside
  // normal JSON body parsing for every route, so the webhook handler can verify
  // Stripe's signature without a separate body-parser exclusion for that one route.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  // Reports 5xx errors to Sentry (if initialised) while keeping Nest's default
  // HTTP responses. Registered here, not in configureApp, so e2e tests keep the
  // plain default filter.
  app.useGlobalFilters(new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter));

  const config = app.get(ConfigService<EnvConfig, true>);
  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  app.get(Logger).log(`API listening on port ${port}`, "Bootstrap");
}

void bootstrap();
