import Link from "next/link";
import type { EnterpriseEnquiry } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { EnterpriseLeadsClient } from "./enterprise-client";
import { TruncationNotice } from "@/components/truncation-notice";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

const TABS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "closed", label: "Closed" },
];

/**
 * The ops Enterprise-leads queue — enquiries from the public "Contact us" form.
 * Defaults to "open" (everything not yet closed), newest first. See
 * docs/adr/0101-enterprise-plan-enquiries.md.
 */
export default async function AdminEnterprisePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = status && TABS.some((t) => t.value === status) ? status : "open";
  const result = await serverApiFetch<Paginated<EnterpriseEnquiry>>(
    `/admin/enterprise-enquiries?status=${active}&perPage=100`,
  );
  const items = result?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <TruncationNotice
        shown={items.length}
        total={result?.total ?? 0}
        unit="leads"
        hint="Triage some to see the rest."
      />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Enterprise leads</h1>
        <p className="text-sm text-foreground/60">
          Enquiries from the Enterprise “Contact us” form. Reply by email and move each one through
          triage as you work it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/enterprise?status=${tab.value}`}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              active === tab.value
                ? "border-black/40 bg-black/5 font-medium"
                : "border-black/15 hover:bg-black/5"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <EnterpriseLeadsClient initialItems={items} />
    </div>
  );
}
