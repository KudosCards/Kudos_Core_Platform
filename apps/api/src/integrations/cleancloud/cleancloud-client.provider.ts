import type { Provider } from "@nestjs/common";
import { CLEANCLOUD_CLIENT } from "./cleancloud-client";
import { HttpCleanCloudClient } from "./http-cleancloud-client";

/** Binds CLEANCLOUD_CLIENT to the real HTTP client. Overridden with a mock in
 * e2e tests so no test ever reaches the CleanCloud network — mirrors the Brevo
 * provider. */
export const cleanCloudClientProvider: Provider = {
  provide: CLEANCLOUD_CLIENT,
  useClass: HttpCleanCloudClient,
};
