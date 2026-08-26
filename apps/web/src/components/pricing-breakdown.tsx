import type { PricingBreakdown } from "@kudos/shared-types";
import { CARD_SIZE_NOTICE } from "@kudos/shared-types";
import { formatGbp } from "@/lib/orders";

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${bold ? "border-t border-border pt-2 font-semibold" : ""}`}
    >
      <span className={muted ? "text-muted" : bold ? "" : "text-muted"}>{label}</span>
      <span className={bold ? "" : muted ? "text-success" : ""}>{value}</span>
    </div>
  );
}

/**
 * The itemised checkout breakdown: card subtotal, plan discount, VAT, postage,
 * total. Card prices are VAT-inclusive, so VAT is shown decomposed (it's part of
 * the total, not added on top); postage is VAT-exempt. Fed by
 * computePricingBreakdown so every surface renders identically. See
 * docs/adr/0060-pricing-breakdown.md.
 */
export function PricingBreakdownCard({
  breakdown,
  estimate,
}: {
  breakdown: PricingBreakdown;
  /** When true, label it as an estimate (pre-payment) rather than the charge. */
  estimate?: boolean;
}) {
  const {
    cardCount,
    cardSubtotalMinor,
    discountMinor,
    vatMinor,
    vatRatePercent,
    postageMinor,
    totalMinor,
  } = breakdown;
  return (
    <div className="grid gap-2 text-sm">
      <Row
        label={`Card subtotal (${cardCount} card${cardCount === 1 ? "" : "s"}, ex VAT)`}
        value={formatGbp(cardSubtotalMinor)}
      />
      {discountMinor > 0 && (
        <Row label="Plan discount" value={`−${formatGbp(discountMinor)}`} muted />
      )}
      <Row label={`VAT (${vatRatePercent}%)`} value={formatGbp(vatMinor)} />
      <Row label="Postage (VAT-exempt)" value={postageMinor > 0 ? formatGbp(postageMinor) : "—"} />
      <Row label={estimate ? "Estimated total" : "Total"} value={formatGbp(totalMinor)} bold />
      {/* Single-size notice: while we stock only A6, every buyer sees the size
          before they pay. Remove/adapt when more sizes ship. */}
      <p className="pt-1 text-xs text-muted">{CARD_SIZE_NOTICE}</p>
    </div>
  );
}
