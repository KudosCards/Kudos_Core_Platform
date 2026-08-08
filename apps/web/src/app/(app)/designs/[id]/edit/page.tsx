import { notFound } from "next/navigation";
import type {
  MessagePageSummary,
  PlanEntitlement,
  SavedDesign,
} from "@kudos/shared-types";
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

  // The saved design is required; the message pages + entitlement power the QR
  // element's "which message page does this link to?" picker (ADR 0137) and
  // must never fail the editor — a page-list hiccup just yields an empty list.
  const [savedDesign, messagePages, entitlement] = await Promise.all([
    serverApiFetch<SavedDesign>(`/saved-designs/${id}`).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }),
    serverApiFetch<MessagePageSummary[]>("/message-pages").catch(() => [] as MessagePageSummary[]),
    serverApiFetch<PlanEntitlement>("/accounts/me/entitlements").catch(() => null),
  ]);
  if (!savedDesign) {
    notFound();
  }

  return (
    <DesignEditorClient
      savedDesign={savedDesign}
      returnTo={returnTo}
      messagePages={messagePages ?? []}
      canAuthorMessagePages={entitlement?.messagePagesEnabled ?? false}
    />
  );
}
