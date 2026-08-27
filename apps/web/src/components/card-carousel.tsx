"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CARD_BLUR_DATA_URL, isOptimizableThumbnail } from "@/lib/card-image";

/**
 * One card in the showcase. Deliberately not `CardDesign`: the carousel needs a
 * picture and a name and nothing else, so the marketing fallback (four PNGs in
 * /public) can satisfy the same type as a row from the live catalog.
 */
export interface CarouselCard {
  id: string;
  name: string;
  thumbnailUrl: string;
}

/**
 * How far each peeking card sits from the one in front of it, and how wide the
 * anchored card is. Both are CSS variables so the taper below is pure CSS —
 * no resize listener, no layout measurement, and the first server-rendered
 * frame is already correct at whatever width it lands on.
 *
 * The numbers come from measuring the real column, not from taste. The card
 * column is 532px from `xl` up, 468 at `lg`, 340 at the `md` breakpoint, and
 * 342 on a 390px phone — so the room to the right of a 320px card runs 212px,
 * 148px, 20px, 22px, plus 24px of page gutter the carousel bleeds into. The
 * pinch is at `md` (768–1023px), where the two-column grid has just kicked in
 * but the column is barely wider than the card; that is why the card stays at
 * 260px until `lg` rather than growing with the breakpoint.
 */
const SIZING =
  "[--card-w:260px] [--step:96px] lg:[--card-w:320px] lg:[--step:84px] xl:[--step:96px]";

/**
 * How many cards peek out to the right, per breakpoint. Three only fits where
 * there is genuinely room for three: below `xl` they would be 40px slivers that
 * read as a rendering fault rather than as more cards.
 *
 *   ≥1280 (xl)   3 peeks
 *   1024 (lg)    2 peeks
 *   768 (md)     1 peek   ← the pinch
 *   <768         1 peek, against a 260px card
 */
const PEEK_VISIBILITY = ["", "", "hidden lg:block", "hidden xl:block"];

/** The furthest slot we ever render. Anything beyond it is off-stage. */
const MAX_SLOT = PEEK_VISIBILITY.length - 1;

/**
 * The card library showcase: one anchored card with the next few peeking out
 * behind it, advancing rightward.
 *
 * The anchored card never moves. Advancing brings the next card into that same
 * slot rather than sliding the whole strip along, which keeps the card the
 * reader is looking at exactly where they are looking. It wraps, so there is no
 * dead end at the far right — the "see all" tile is simply the last thing in
 * the rotation before it comes back round to the first card.
 */
export function CardCarousel({ cards }: { cards: CarouselCard[] }) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  // The "see all" tile rides in the rotation as one more item, so it inherits
  // the peeking and the wrap for free instead of being a special case pinned to
  // an end that, in a looping carousel, does not exist.
  const total = cards.length + 1;
  const advance = useCallback(() => setIndex((i) => (i + 1) % total), [total]);

  function onTouchEnd(event: React.TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    // Only a right-to-left swipe advances. A swipe the other way does nothing:
    // this carousel goes one way, and the dots are there for jumping about.
    if (start - event.changedTouches[0]!.clientX > 40) advance();
  }

  if (cards.length === 0) return null;

  const current = index < cards.length ? cards[index]!.name : "All designs";

  return (
    <div className="flex flex-col gap-5">
      {/*
        Two nested boxes doing two different jobs. The outer one bleeds into the
        page gutter and clips, so a peek can run to the edge of the screen
        without giving the page a horizontal scrollbar. The inner one is exactly
        one card wide and carries the aspect ratio, so it — and nothing else —
        decides how tall the whole thing is.
      */}
      <div
        className={`relative -mr-6 overflow-hidden ${SIZING}`}
        role="group"
        aria-roledescription="carousel"
        aria-label="Card designs"
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]!.clientX;
        }}
        onTouchEnd={onTouchEnd}
      >
        <div className="relative aspect-[105/148] w-[var(--card-w)]">
          {Array.from({ length: total }, (_, item) => {
            // Where this item sits relative to the anchored one, wrapping round.
            const slot = (item - index + total) % total;
            if (slot > MAX_SLOT) return null;
            const isSeeAll = item === cards.length;
            const card = isSeeAll ? null : cards[item]!;
            return (
              <div
                key={isSeeAll ? "see-all" : card!.id}
                className={`absolute inset-y-0 left-0 w-[var(--card-w)] origin-left transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${PEEK_VISIBILITY[slot]}`}
                style={{
                  // Depth comes from the scale step and each card's own shadow,
                  // not from fading. On this white page a peek at 0.5 opacity
                  // reads as a rendering fault rather than as a card behind —
                  // the dark-background carousels this pattern comes from can
                  // fade hard because the page underneath is doing the work.
                  transform: `translateX(calc(var(--step) * ${slot})) scale(${1 - slot * 0.04})`,
                  opacity: 1 - slot * 0.05,
                  zIndex: MAX_SLOT - slot,
                }}
                // Only the anchored card is content; the rest are slivers of the
                // ones coming next, and reading them out would be noise.
                aria-hidden={slot !== 0}
              >
                {isSeeAll ? <SeeAllTile /> : <CardFace card={card!} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={advance}
          aria-label="Next card design"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg text-slate-700 shadow-md ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <span aria-hidden>→</span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: total }, (_, item) => (
            <button
              key={item}
              type="button"
              onClick={() => setIndex(item)}
              aria-label={
                item === cards.length ? "Show all designs" : `Show card ${item + 1} of ${total}`
              }
              aria-current={item === index ? "true" : undefined}
              className={`h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                item === index ? "w-5 bg-slate-800" : "w-1.5 bg-slate-300 hover:bg-slate-400"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Announced on change for anyone who cannot see which card moved in. */}
      <p aria-live="polite" className="sr-only">
        {current}, {index + 1} of {total}
      </p>
    </div>
  );
}

function CardFace({ card }: { card: CarouselCard }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-slate-50 shadow-2xl ring-1 ring-slate-100">
      <Image
        src={card.thumbnailUrl}
        alt={card.name}
        fill
        sizes="320px"
        placeholder="blur"
        blurDataURL={CARD_BLUR_DATA_URL}
        // A thumbnail from anywhere but our own bucket makes next/image throw at
        // render, which would take the whole homepage down. See card-image.ts.
        unoptimized={!isOptimizableThumbnail(card.thumbnailUrl)}
        className="object-cover"
      />
    </div>
  );
}

function SeeAllTile() {
  return (
    <Link
      href="/cards"
      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl bg-slate-900 p-6 text-center shadow-2xl ring-1 ring-slate-100 transition-colors hover:bg-slate-800"
    >
      <span className="text-lg font-semibold text-white">See all designs</span>
      <span className="text-sm text-slate-300">Browse the full card library →</span>
    </Link>
  );
}
