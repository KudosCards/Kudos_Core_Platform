import Link from "next/link";
import { MessagePageBuilder } from "../builder";

export default function NewMessagePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/message-pages" className="text-sm text-muted hover:underline">
          ← Message pages
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New message page</h1>
      </div>
      <MessagePageBuilder page={null} />
    </div>
  );
}
