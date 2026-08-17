import { ImageResponse } from "next/og";

/**
 * The share image every marketing page inherits — what WhatsApp, Facebook,
 * LinkedIn and Slack render when someone pastes a Kudos Cards link. Generated at
 * build rather than hand-exported so the wording stays in version control with
 * the rest of the copy.
 *
 * `/cards/[id]` overrides this with the card's own artwork (see its
 * generateMetadata) — a real card front sells better than any layout we'd draw
 * here. See docs/seo-plan.md (Phase 2).
 *
 * Deliberately no custom font: `next/font` faces aren't available to the OG
 * runtime without shipping the file, and a Google Fonts fetch at build would be
 * a network dependency in the build path. The system stack renders fine at this
 * size.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Kudos Cards — real cards, printed and posted for you";

const CORAL = "#ef5b52";
const INK = "#0f172a";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "linear-gradient(135deg, #ffffff 0%, #eff6ff 100%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 999,
            backgroundColor: CORAL,
            display: "flex",
          }}
        />
        <div style={{ fontSize: 30, fontWeight: 700, color: INK, letterSpacing: -0.5 }}>
          Kudos Cards
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            color: INK,
            lineHeight: 1.05,
            letterSpacing: -2,
            maxWidth: 900,
          }}
        >
          Send one card, or automate thousands
        </div>
        <div style={{ fontSize: 34, color: "#475569", lineHeight: 1.3, maxWidth: 860 }}>
          Real, personalised cards — printed and posted for you.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            backgroundColor: CORAL,
            color: "#ffffff",
            fontSize: 26,
            fontWeight: 700,
            padding: "16px 32px",
            borderRadius: 999,
          }}
        >
          Start for free
        </div>
        <div style={{ fontSize: 26, color: "#64748b", display: "flex" }}>kudos-cards.co.uk</div>
      </div>
    </div>,
    size,
  );
}
