import { serverApiFetch } from "@/lib/api.server";
import { MessagesClient, type AccountMessagePage } from "./messages-client";

export default async function MessagesPage() {
  const pages = await serverApiFetch<AccountMessagePage[]>("/messages");
  return <MessagesClient initialPages={pages ?? []} />;
}
