import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { JWKS_RESOLVER } from "../../src/auth/jwks.provider";
import { getTestJwks } from "./test-jwks";

export interface ProviderOverride {
  provide: unknown;
  useValue: unknown;
}

/**
 * Boots a full app instance through the exact same pipeline main.ts uses,
 * with the real JWKS_RESOLVER (which would otherwise fetch a real
 * Supabase project's JWKS over the network) swapped for a local one so
 * e2e tests don't depend on network access or a live Supabase project —
 * see test/util/test-jwks.ts for the matching token minter. Pass
 * `overrides` for additional providers a specific test file needs to fake
 * out (e.g. STRIPE_CLIENT, so billing tests never make a real network call).
 */
export async function createTestApp(
  overrides: ProviderOverride[] = [],
): Promise<INestApplication<App>> {
  const jwks = await getTestJwks();

  let builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(JWKS_RESOLVER)
    .useValue(jwks);

  for (const { provide, useValue } of overrides) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }

  const moduleFixture = await builder.compile();

  // rawBody: true, same as main.ts — the Stripe webhook e2e tests need
  // req.rawBody to construct a real signed payload against the test app.
  const app = moduleFixture.createNestApplication<INestApplication<App>>({ rawBody: true });
  configureApp(app);
  await app.init();
  return app;
}
