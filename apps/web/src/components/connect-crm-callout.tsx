import Link from "next/link";

/** The integrations a subscriber can sync contacts from — kept in step with
 * the live connectors on the Integrations page. */
const PROVIDERS = ["Brevo", "HubSpot", "Zapier", "Your own API"];

/**
 * Awareness nudge shown next to the manual "add contacts" paths (the recipients
 * page and the guided-setup upload step): points new users at the CRM
 * integrations so they know they don't have to re-upload CSVs. The connect flows
 * themselves live on /integrations. See docs/adr/0020-crm-awareness-widget.md.
 *
 * `compact` renders a single line (for the onboarding step); the default renders
 * the full bordered card (for the recipients page).
 */
export function ConnectCrmCallout({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-sm text-muted">
        Prefer to sync from a CRM? Connect Brevo, HubSpot or Zapier on the{" "}
        <Link href="/integrations" className="text-accent hover:underline">
          integrations page
        </Link>
        .
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold">Rather sync automatically?</h2>
          <p className="text-sm text-muted">
            Connect your CRM to keep contacts in sync — no CSVs to re-upload.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDERS.map((provider) => (
            <span
              key={provider}
              className="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
            >
              {provider}
            </span>
          ))}
        </div>
      </div>
      <Link href="/integrations" className="btn-accent shrink-0">
        Connect an integration →
      </Link>
    </section>
  );
}
