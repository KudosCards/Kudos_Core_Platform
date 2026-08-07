import { notFound } from "next/navigation";
import type { MessagePageSummary, PlanEntitlement, SavedDesign } from "@kudos/shared-types";
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

  // Message pages + plan entitlement, so the composer can offer the QR-gated
  // "attach a message page?" step when this design carries a QR (ADR 0132).
  const [messagePages, entitlement] = await Promise.all([
    serverApiFetch<MessagePageSummary[]>("/message-pages"),
    serverApiFetch<PlanEntitlement>("/accounts/me/entitlements"),
  ]);

  return (
    <SendCardClient
      designId={design.id}
      designName={design.name}
      designDocument={design.document}
      messagePages={messagePages ?? []}
      canAuthorMessagePages={entitlement?.messagePagesEnabled ?? false}
    />
  );
}
