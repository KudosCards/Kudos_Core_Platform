import type { Team } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const team = await serverApiFetch<Team>("/team");

  if (!team) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Team</h1>
        <p className="mt-2 text-muted">Couldn&apos;t load your team just now — please refresh.</p>
      </div>
    );
  }

  return <TeamClient initialTeam={team} />;
}
