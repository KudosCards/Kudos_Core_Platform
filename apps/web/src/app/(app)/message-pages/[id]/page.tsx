import Link from "next/link";
import { notFound } from "next/navigation";
import type { MessagePageDetail } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { MessagePageBuilder } from "../builder";

export default async function EditMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await serverApiFetch<MessagePageDetail>(`/message-pages/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    },
  );
  if (!page) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/message-pages" className="text-sm text-muted hover:underline">
          ← Message pages
        </Link>
        <h1 className="mt-2 truncate text-2xl font-bold tracking-tight">{page.title}</h1>
      </div>
      <MessagePageBuilder page={page} />
    </div>
  );
}
