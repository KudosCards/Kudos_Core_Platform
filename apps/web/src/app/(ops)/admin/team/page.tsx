import type { AdminTeam } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { AdminTeamClient } from "./admin-team-client";

/** Operator team management — list operators, invite by email, set roles, revoke.
 * Nav shows this only to super admins; the API enforces the same. See ADR 0040. */
export default async function AdminTeamPage() {
  const team = await serverApiFetch<AdminTeam>("/admin/team");
  if (!team) return null;
  return <AdminTeamClient initialTeam={team} />;
}
