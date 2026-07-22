import type { Recipient } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { GetStartedClient } from "./get-started-client";

interface Paginated<T> {
  items: T[];
  total: number;
}

export default async function GetStartedPage() {
  // How many contacts already on file — decides whether the "upload" step shows
  // as to-do or done when they return to this page.
  const recipients = await serverApiFetch<Paginated<Recipient>>("/recipients?perPage=1");

  return <GetStartedClient initialRecipientCount={recipients?.total ?? 0} />;
}
