import type { ImportSummary } from "./csv-import";

/**
 * What one CSV import did, including every row it could not take and why.
 *
 * Its own component because it is needed in two places: inside the import
 * dialog, and on the Contacts page after the dialog is closed. It used to live
 * only inside the dialog, and the Contacts page closed that dialog the instant
 * the import returned — so the report was built and destroyed in the same
 * commit and no one ever saw it. See ADR 0198.
 */
export function ImportReport({ summary }: { summary: ImportSummary }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-lg bg-success-soft px-4 py-2 text-sm font-medium text-success">
        Imported {summary.created} new, updated {summary.updated}
        {summary.warnings.length > 0 && `, ${summary.warnings.length} with a field skipped`}
        {summary.rejected.length > 0 && `, skipped ${summary.rejected.length}`}.
      </p>
      {summary.rejected.length > 0 && (
        <details className="rounded-lg border border-border px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-accent">
            {summary.rejected.length} row{summary.rejected.length === 1 ? "" : "s"} couldn’t be
            imported — see why
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
            {summary.rejected.slice(0, 20).map((r) => (
              <li key={`r-${r.row}`}>
                Row {r.row}: {r.reason}
              </li>
            ))}
            {summary.rejected.length > 20 && <li>…and {summary.rejected.length - 20} more</li>}
          </ul>
        </details>
      )}
      {summary.warnings.length > 0 && (
        <details className="rounded-lg border border-border px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            {summary.warnings.length} contact{summary.warnings.length === 1 ? "" : "s"} imported
            with a field skipped — see details
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
            {summary.warnings.slice(0, 20).map((w, i) => (
              <li key={`w-${w.row}-${i}`}>
                Row {w.row}: {w.message}
              </li>
            ))}
            {summary.warnings.length > 20 && <li>…and {summary.warnings.length - 20} more</li>}
          </ul>
        </details>
      )}
    </div>
  );
}
