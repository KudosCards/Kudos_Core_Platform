import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import type { EnvConfig } from "./config/env.schema";

/**
 * Applied to every app instance — production (main.ts) and every e2e test
 * alike — so tests exercise the exact same request pipeline (validation,
 * CORS, security headers) that production runs, not a lookalike.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<EnvConfig, true>);

  app.use(helmet());
  app.enableCors({ origin: config.get("WEB_APP_URL", { infer: true }), credentials: true });
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
