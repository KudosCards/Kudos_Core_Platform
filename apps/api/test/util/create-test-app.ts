import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { JWKS_RESOLVER } from "../../src/auth/jwks.provider";
import { getTestJwks } from "./test-jwks";

/**
 * Boots a full app instance through the exact same pipeline main.ts uses,
 * with the real JWKS_RESOLVER (which would otherwise fetch a real
 * Supabase project's JWKS over the network) swapped for a local one so
 * e2e tests don't depend on network access or a live Supabase project —
 * see test/util/test-jwks.ts for the matching token minter.
 */
export async function createTestApp(): Promise<INestApplication<App>> {
  const jwks = await getTestJwks();

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(JWKS_RESOLVER)
    .useValue(jwks)
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}
