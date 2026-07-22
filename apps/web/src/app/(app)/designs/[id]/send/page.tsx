import { notFound } from "next/navigation";
import type { SavedDesign } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ApiError } from "@/lib/api";
import { SendCardClient } from "./send-card-client";

export default async function SendCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let design: SavedDesign | null;
  try {
    design = await serverApiFetch<SavedDesign>(`/saved-designs/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
  if (!design) {
    notFound();
  }

  return <SendCardClient designId={design.id} designName={design.name} />;
}
