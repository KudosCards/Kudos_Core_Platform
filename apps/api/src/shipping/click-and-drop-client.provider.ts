import type { Provider } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import {
  HttpClickAndDropClient,
  NoopClickAndDropClient,
  type ClickAndDropClient,
  type ClickAndDropServiceCodes,
} from "./click-and-drop-client";

export const CLICK_AND_DROP_CLIENT = Symbol("CLICK_AND_DROP_CLIENT");

/**
 * Wires the real Click & Drop client only when CLICK_AND_DROP_API_KEY is set;
 * otherwise a no-op so the app boots and nothing is pushed. Always overridable in
 * tests (see test/util/create-test-app.ts), the same way STRIPE_CLIENT /
 * ROYAL_MAIL_CLIENT are — no test ever hits the real Click & Drop API.
 */
export const clickAndDropClientProvider: Provider = {
  provide: CLICK_AND_DROP_CLIENT,
  useFactory: (config: ConfigService<EnvConfig, true>): ClickAndDropClient => {
    const apiKey = config.get("CLICK_AND_DROP_API_KEY", { infer: true });
    if (!apiKey) {
      new Logger("ClickAndDropClient").log(
        "CLICK_AND_DROP_API_KEY unset — order import to Click & Drop disabled.",
      );
      return new NoopClickAndDropClient();
    }
    const baseUrl = config.get("CLICK_AND_DROP_API_BASE_URL", { infer: true });
    const serviceCodes: ClickAndDropServiceCodes = {
      first_class: config.get("CLICK_AND_DROP_SERVICE_CODE_FIRST", { infer: true }),
      second_class: config.get("CLICK_AND_DROP_SERVICE_CODE_SECOND", { infer: true }),
    };
    return new HttpClickAndDropClient(apiKey, baseUrl, serviceCodes);
  },
  inject: [ConfigService],
};
