import { redirect } from "next/navigation";

/**
 * Segments moved to /lists, where hand-picked and smart lists live side by
 * side under one word. Kept as a redirect so bookmarks and any emailed link
 * still land somewhere useful. See docs/adr/0177.
 */
export default function SegmentsPage() {
  redirect("/lists");
}
