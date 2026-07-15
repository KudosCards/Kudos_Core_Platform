import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";
import type { EnvConfig } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get(ConfigService<EnvConfig, true>);
  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  app.get(Logger).log(`API listening on port ${port}`, "Bootstrap");
}

void bootstrap();
