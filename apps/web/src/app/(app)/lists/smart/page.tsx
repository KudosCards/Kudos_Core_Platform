import { redirect } from "next/navigation";

/** `/lists/smart` on its own isn't a list — send it back to the index rather
 * than letting it fall through to `/lists/[id]` and 404 as a missing list. */
export default function SmartListsIndexPage() {
  redirect("/lists");
}
