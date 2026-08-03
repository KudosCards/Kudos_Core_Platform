/**
 * The curated sticker library. Each sticker is a self-hosted SVG under
 * `public/stickers/` — same-origin (no CORS taint), crisp vector, no upload
 * pipeline. Placed as a normal image element (`assetUrl` = the sticker's
 * root-relative path), so stickers get resize/rotate/snap/layer for free.
 */
export interface Sticker {
  key: string;
  label: string;
  /** Root-relative path served from the app's public dir. */
  src: string;
}

export const STICKERS: Sticker[] = [
  { key: "balloon", label: "Balloon", src: "/stickers/balloon.svg" },
  { key: "gift", label: "Gift", src: "/stickers/gift.svg" },
  { key: "cake", label: "Cake", src: "/stickers/cake.svg" },
  { key: "party-hat", label: "Party hat", src: "/stickers/party-hat.svg" },
  { key: "confetti", label: "Confetti", src: "/stickers/confetti.svg" },
  { key: "flower", label: "Flower", src: "/stickers/flower.svg" },
  { key: "crown", label: "Crown", src: "/stickers/crown.svg" },
  { key: "rainbow", label: "Rainbow", src: "/stickers/rainbow.svg" },
];

/** The design-space size a freshly-placed sticker gets (square artwork). */
export const STICKER_INSERT_SIZE = 110;
