import type { CardDesign, PlanEntitlement, SavedDesign } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { DesignsClient } from "./designs-client";

export default async function DesignsPage() {
  const [templates, savedDesigns, entitlement] = await Promise.all([
    serverApiFetch<CardDesign[]>("/card-designs"),
    serverApiFetch<SavedDesign[]>("/saved-designs"),
    serverApiFetch<PlanEntitlement>("/accounts/me/entitlements"),
  ]);

  return (
    <DesignsClient
      templates={templates ?? []}
      initialSavedDesigns={savedDesigns ?? []}
      customArtworkEnabled={entitlement?.customArtworkEnabled ?? false}
    />
  );
}
