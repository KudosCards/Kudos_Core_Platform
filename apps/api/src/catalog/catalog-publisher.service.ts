import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";

/**
 * Publishes the catalog to the public marketing site after a sync.
 *
 * The library at /cards is cached (ISR), while the signed-in app reads the same
 * endpoint uncached. That asymmetry is why a card could be live in the app and
 * missing from the marketing site: the public page's only notion of freshness
 * was a one-hour timer, and nothing connected "the catalog changed" to "the
 * cached pages are wrong".
 *
 * This is that connection. Best-effort by design — a sync that wrote its rows
 * correctly has succeeded, whether or not the web app could be reached, so this
 * never throws. It reports what happened instead, and the ops UI shows it.
 */

export type CatalogPublishOutcome = "published" | "not-configured" | "failed";

export interface CatalogPublishResult {
  outcome: CatalogPublishOutcome;
  /** Why, when it isn't `published` — shown to the operator verbatim. */
  reason?: string;
}

/** A publish must never be the reason a sync appears to hang. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** Grace for the background rebuild between the two warming requests. */
const WARM_SETTLE_MS = 750;

@Injectable()
export class CatalogPublisherService {
  private readonly logger = new Logger(CatalogPublisherService.name);

  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  async publish(): Promise<CatalogPublishResult> {
    const secret = this.config.get("CATALOG_REVALIDATE_SECRET", { infer: true });
    if (!secret) {
      this.logger.log("Catalog published to the database only — CATALOG_REVALIDATE_SECRET not set");
      return {
        outcome: "not-configured",
        reason:
          "CATALOG_REVALIDATE_SECRET isn't set on the API, so the public library will refresh on its own within the hour rather than immediately.",
      };
    }

    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const url = `${webAppUrl.replace(/\/$/, "")}/api/revalidate-catalog`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "x-catalog-revalidate-secret": secret },
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      });

      if (!response.ok) {
        // The route explains itself in the body (unset secret, mismatch); pass
        // that through rather than reporting a bare status code.
        const body = await response.text().catch(() => "");
        const reason = `The web app answered ${response.status} when asked to publish${body ? `: ${body.slice(0, 200)}` : ""}`;
        this.logger.error(reason);
        return { outcome: "failed", reason };
      }

      // Second request, deliberately. The purge only takes effect once the
      // revalidate request has finished, and regeneration is
      // stale-while-revalidate — so without this the next visitor still gets the
      // old library and merely triggers the rebuild behind themselves. Asking
      // for /cards now means the rebuild happens on our time rather than an
      // operator's, and they see the new catalog on their first look.
      //
      // Never fatal: a failed warm just restores the old behaviour (the page
      // rebuilds on someone's next visit), and the purge above is what matters.
      await this.warmCatalogPage(webAppUrl);

      this.logger.log("Catalog published — public card library refreshed");
      return { outcome: "published" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const reason = `Could not reach the web app to publish the catalog: ${message}`;
      this.logger.error(reason);
      return { outcome: "failed", reason };
    }
  }

  /**
   * Rebuild /cards now rather than on some visitor's first, stale load.
   *
   * Two requests, not one, and that isn't belt-and-braces. Regeneration is
   * stale-while-revalidate: the first request after a purge is *served the old
   * page* and only starts the rebuild behind itself. So one warm just moves the
   * stale response to us — which is the point — but the fresh page only exists
   * once that rebuild finishes. The second request, after a short pause, is the
   * one that confirms it landed. Measured against a production build: the
   * rebuild completed ~57ms after the first warm, so the pause below is an
   * order of magnitude more than it needs.
   */
  private async warmCatalogPage(webAppUrl: string): Promise<void> {
    const url = `${webAppUrl.replace(/\/$/, "")}/cards`;
    const get = async (): Promise<void> => {
      await fetch(url, { signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
    };
    try {
      await get();
      await new Promise((resolve) => setTimeout(resolve, WARM_SETTLE_MS));
      await get();
    } catch (error) {
      this.logger.warn(
        `Catalog published, but couldn't warm /cards: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
