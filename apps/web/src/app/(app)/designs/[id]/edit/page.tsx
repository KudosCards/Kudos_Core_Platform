import { notFound } from "next/navigation";
import type { SavedDesign } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { DesignEditorClient } from "./design-editor-client";

export default async function EditDesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const { returnTo } = await searchParams;

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

  return <DesignEditorClient savedDesign={savedDesign} returnTo={returnTo} />;
}
