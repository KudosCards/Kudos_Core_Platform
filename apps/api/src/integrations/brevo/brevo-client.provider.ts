import type { Provider } from "@nestjs/common";
import { BREVO_CLIENT } from "./brevo-client";
import { HttpBrevoClient } from "./http-brevo-client";

/** Binds BREVO_CLIENT to the real HTTP client. Overridden with a mock in e2e
 * tests so no test ever reaches the Brevo network — mirrors CATALOG_SOURCE. */
export const brevoClientProvider: Provider = {
  provide: BREVO_CLIENT,
  useClass: HttpBrevoClient,
};
