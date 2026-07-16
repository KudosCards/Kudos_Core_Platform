import { notFound } from "next/navigation";
import type { SavedDesign } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { DesignEditorClient } from "./design-editor-client";

export default async function EditDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const savedDesign = await serverApiFetch<SavedDesign>(`/saved-designs/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    },
  );
  if (!savedDesign) {
    notFound();
  }

  return <DesignEditorClient savedDesign={savedDesign} />;
}
