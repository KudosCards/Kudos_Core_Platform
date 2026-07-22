/**
 * The single branded shell every outbound Kudos Cards email is rendered into,
 * so reminders, receipts and anything added later look like one product rather
 * than a pile of ad-hoc `<div>`s. Kept deliberately email-safe: table-based
 * layout, inline styles only, a bulletproof button, a hidden preheader, and a
 * hosted logo (email clients can't load app-relative assets). See docs/adr/0025.
 *
 * This is the HTML fallback used when no Brevo template is configured for a
 * given email; a Brevo template, when set, supersedes it (see email.client.ts).
 */

/** Brand palette, mirrored from the web app's globals.css so email and app agree. */
export const BRAND = {
  accent: "#e5372a",
  accentHover: "#c92e22",
  accentSoft: "#fcebe9",
  canvas: "#f4f3f1",
  surface: "#ffffff",
  ink: "#1b1a18",
  muted: "#6f6b66",
  border: "#e7e3dd",
} as const;

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface BrandedEmailOptions {
  /** Base URL of the web app — sources the hosted logo and footer links. */
  webAppUrl: string;
  /** Hidden inbox-preview text (the grey line beside the subject). */
  preheader: string;
  /** The email's H1. */
  heading: string;
  /** Main body — trusted HTML the caller has already escaped where needed. */
  bodyHtml: string;
  /** Optional primary call-to-action rendered as the branded button. */
  cta?: { url: string; label: string };
  /**
   * When true, a plain "button not working? paste this link" fallback is shown
   * under the CTA. Use for links that must work even if the button doesn't
   * render (auth: confirm, magic link, password reset).
   */
  showLinkFallback?: boolean;
  /** Optional small print above the standard footer (e.g. an opt-out note). */
  footerNote?: string;
}

/** A bulletproof, table-based CTA button that survives Outlook and dark mode. */
export function emailButton(url: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
      <tr>
        <td align="center" bgcolor="${BRAND.accent}" style="border-radius:9999px">
          <a href="${url}"
             style="display:inline-block;padding:13px 28px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9999px">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

/** Wrap body content in the full branded HTML document. */
export function renderBrandedEmail(options: BrandedEmailOptions): string {
  const { webAppUrl, preheader, heading, bodyHtml, cta, showLinkFallback, footerNote } = options;
  const logoUrl = `${webAppUrl}/marketing/logo.png`;
  const year = new Date().getUTCFullYear();
  const ctaHtml = cta ? emailButton(cta.url, cta.label) : "";
  const linkFallbackHtml =
    cta && showLinkFallback
      ? `<p style="margin:4px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${BRAND.muted}">
           Button not working? Copy and paste this link into your browser:<br>
           <a href="${cta.url}" style="color:${BRAND.accent};word-break:break-all">${cta.url}</a>
         </p>`
      : "";
  const footerNoteHtml = footerNote
    ? `<p style="margin:0 0 12px;font-size:12px;line-height:18px;color:${BRAND.muted}">${footerNote}</p>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="https://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">
    ${preheader}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.canvas}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">
          <tr>
            <td align="center" style="padding:8px 0 24px">
              <a href="${webAppUrl}" style="text-decoration:none">
                <img src="${logoUrl}" width="88" alt="Kudos Cards"
                     style="display:block;width:88px;height:auto;border:0;outline:none;text-decoration:none">
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:16px;padding:32px 28px">
              <h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:22px;line-height:28px;font-weight:700;color:${BRAND.ink}">
                ${heading}
              </h1>
              <div style="font-family:${FONT_STACK};font-size:15px;line-height:23px;color:${BRAND.ink}">
                ${bodyHtml}
              </div>
              ${ctaHtml}
              ${linkFallbackHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px">
              ${footerNoteHtml}
              <p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:13px;line-height:19px;color:${BRAND.ink};font-weight:600">
                Kudos Cards
              </p>
              <p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${BRAND.muted}">
                Automated cards that mean something — sent on time, every time.
              </p>
              <p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${BRAND.muted}">
                <a href="${webAppUrl}" style="color:${BRAND.muted};text-decoration:underline">kudoscards.co.uk</a>
                &nbsp;·&nbsp; &copy; ${year} Kudos Cards
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
