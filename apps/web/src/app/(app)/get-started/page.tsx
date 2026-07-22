import type { Account, Recipient } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { GetStartedClient } from "./get-started-client";

interface Paginated<T> {
  items: T[];
  total: number;
}

export default async function GetStartedPage() {
  // Contacts already on file decide whether step 1 shows as to-do or done; the
  // account type decides whether we lead with a single "add a birthday" (a
  // personal/individual account) or a bulk contact-list import (a business).
  const [recipients, account] = await Promise.all([
    serverApiFetch<Paginated<Recipient>>("/recipients?perPage=1"),
    serverApiFetch<Account>("/accounts/me"),
  ]);

  return (
    <GetStartedClient
      initialRecipientCount={recipients?.total ?? 0}
      accountType={account?.type ?? "organisation"}
    />
  );
}
