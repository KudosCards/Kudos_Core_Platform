import type { DesignDocument, Recipient, SavedDesign } from "@kudos/shared-types";
import { applyMergeText } from "@kudos/shared-types";

/**
 * The bulk-send **proof / contact sheet** (ADR 0118): a self-contained,
 * print-ready HTML document listing every card in a run — the recipient, the
 * exact address it posts to, and the personalised message as it will print (so
 * `{name}` is shown resolved, per person). The buyer downloads it before paying
 * a five-figure run as an offline record they can check, share, or file — and
 * the same sheet backs the order afterwards. Text is HTML-escaped, so a stray
 * `<` in a contact's data can never break (or inject into) the document.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The recipient's full postal address as printed lines. */
function addressLines(recipient: Recipient): string[] {
  return [
    recipient.addressLine1,
    recipient.addressLine2,
    recipient.addressCity,
    recipient.addressPostcode,
    recipient.addressCountry && recipient.addressCountry !== "GB" ? recipient.addressCountry : null,
  ].filter((line): line is string => !!line && line.trim().length > 0);
}

/** The personalised text a recipient's card carries, resolved and de-duplicated,
 * in page order — the proof that each merge token filled in for that person. */
function personalisedMessage(document: DesignDocument, recipient: Recipient): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const page of document.pages) {
    for (const element of page.elements) {
      if (element.kind !== "text") continue;
      const resolved = applyMergeText(element.text, recipient).trim();
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        parts.push(resolved);
      }
    }
  }
  return parts.join(" · ");
}

export interface ContactSheetMeta {
  /** e.g. "2nd class" — how the run posts. */
  postageLabel: string;
  /** The exact charge, pre-formatted (e.g. "£6.82"), when known. */
  totalLabel?: string;
}

/** Build the full contact-sheet HTML document for a run. */
export function buildContactSheetHtml(
  design: SavedDesign,
  recipients: Recipient[],
  meta: ContactSheetMeta,
): string {
  const generatedOn = new Date().toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const rows = recipients
    .map((recipient, index) => {
      const name = `${recipient.firstName} ${recipient.lastName}`.trim();
      const address = addressLines(recipient).map(escapeHtml).join("<br>");
      const message = personalisedMessage(design.document, recipient);
      return `<tr>
        <td class="num">${index + 1}</td>
        <td class="name">${escapeHtml(name)}</td>
        <td class="addr">${address || '<span class="muted">—</span>'}</td>
        <td class="msg">${message ? escapeHtml(message) : '<span class="muted">—</span>'}</td>
      </tr>`;
    })
    .join("\n");

  const total = meta.totalLabel ? ` · ${escapeHtml(meta.totalLabel)}` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kudos proof sheet — ${escapeHtml(design.name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 32px; background: #fff; }
  header { margin-bottom: 20px; border-bottom: 2px solid #111; padding-bottom: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 12px; }
  .actions { margin: 16px 0; }
  button { font: inherit; padding: 8px 14px; border: 1px solid #111; background: #111; color: #fff; border-radius: 6px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #ddd; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; border-bottom: 1.5px solid #999; }
  td.num { color: #999; width: 40px; }
  td.name { font-weight: 600; white-space: nowrap; }
  td.addr { width: 30%; }
  .muted { color: #aaa; }
  tr { break-inside: avoid; }
  @media print {
    body { padding: 0; }
    .actions { display: none; }
    thead { display: table-header-group; }
  }
</style>
</head>
<body>
<header>
  <h1>Proof sheet — ${escapeHtml(design.name)}</h1>
  <p class="meta">${recipients.length} card${recipients.length === 1 ? "" : "s"} · ${escapeHtml(meta.postageLabel)}${total} · generated ${escapeHtml(generatedOn)}</p>
</header>
<div class="actions">
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<table>
  <thead>
    <tr><th class="num">#</th><th>Recipient</th><th>Posts to</th><th>Personalised message</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>`;
}

/** Generate the sheet and hand the browser a downloadable .html file (which the
 * recipient can open and Print → Save as PDF). Returns the filename used. */
export function downloadContactSheet(
  design: SavedDesign,
  recipients: Recipient[],
  meta: ContactSheetMeta,
): string {
  const html = buildContactSheetHtml(design, recipients, meta);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "run";
  const date = new Date().toISOString().slice(0, 10);
  const filename = `kudos-proof-${slug}-${date}.html`;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the download a tick to start before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}
