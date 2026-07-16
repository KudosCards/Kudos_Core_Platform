import type { CardDesign, SavedDesign } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { DesignsClient } from "./designs-client";

export default async function DesignsPage() {
  const [templates, savedDesigns] = await Promise.all([
    serverApiFetch<CardDesign[]>("/card-designs"),
    serverApiFetch<SavedDesign[]>("/saved-designs"),
  ]);

  return <DesignsClient templates={templates ?? []} initialSavedDesigns={savedDesigns ?? []} />;
}
