import { serverApiFetch } from "@/lib/api.server";
import { StorageClient } from "./storage-client";

export default async function StoragePage() {
  const status = await serverApiFetch<{ enabled: boolean }>("/storage-maintenance/status");
  return <StorageClient enabled={status?.enabled ?? false} />;
}
