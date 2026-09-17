import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";
import type { EnvConfig } from "./config/env.schema";
import { initSentry, Sentry } from "./observability/sentry";

/**
 * Last line of defence for a throw no `try`/`catch` can reach.
 *
 * Node runs some callbacks outside every promise chain — `zlib.inflate`'s is the
 * one that bit us: pdfkit's PNG decoder rethrows there, so a single corrupt image
 * in a print run took the whole process down with nothing attributable in the
 * logs. That specific hole is closed at the decoder now (see image-loader.ts), but
 * the shape of it is not unique to images, and a process that dies silently is
 * worse than one that dies loudly.
 *
 * Registered explicitly rather than left to Sentry: Sentry's own handler declines
 * to exit when another listener is present, so a half-installed pair of handlers
 * would leave the process running in an undefined state — the one outcome Node is
 * clear you must not choose. This logs, reports, flushes, and exits.
 */
function installCrashReporter(): void {
  const die = (kind: string) => (error: unknown) => {
    console.error(`FATAL ${kind}:`, error);
    Sentry.captureException(error);
    void Sentry.flush(2000).finally(() => process.exit(1));
  };
  process.on("uncaughtException", die("uncaughtException"));
  process.on("unhandledRejection", die("unhandledRejection"));
}

async function bootstrap(): Promise<void> {
  // Before app creation so Sentry's instrumentation wraps everything. No-op
  // unless SENTRY_DSN is set (unchanged behaviour in dev/test).
  initSentry();
  installCrashReporter();

  // rawBody: true exposes req.rawBody (the exact bytes Stripe signed) alongside
  // normal JSON body parsing for every route, so the webhook handler can verify
  // Stripe's signature without a separate body-parser exclusion for that one route.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get(ConfigService<EnvConfig, true>);
  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  app.get(Logger).log(`API listening on port ${port}`, "Bootstrap");
}

void bootstrap();
