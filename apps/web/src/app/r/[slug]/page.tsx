import { env } from "@/lib/env";

/**
 * Public QR-linked digital message page — no login, no app required. The
 * physical card posted to a recipient carries a QR code that resolves here.
 * Fetches the public GET /messages/:slug endpoint directly (no auth token);
 * that endpoint increments the view count and returns only the safe public
 * fields — never account, order, or address data.
 */

interface PublicMessagePage {
  message: string | null;
  emoji: string | null;
  videoUrl: string | null;
  recipientFirstName: string;
  occasionType: string;
}

const OCCASION_GREETINGS: Record<string, string> = {
  birthday: "Happy Birthday",
  achievement: "Congratulations",
  leaver: "Good luck",
  staff_recognition: "Thank you",
  seasonal: "Season's greetings",
  bespoke_campaign: "A message for you",
};

async function fetchMessagePage(slug: string): Promise<PublicMessagePage | null> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/messages/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }
  return response.json() as Promise<PublicMessagePage>;
}

export default async function MessagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await fetchMessagePage(slug);

  if (!page) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-lg font-semibold">This message couldn&apos;t be found</p>
        <p className="max-w-sm text-muted">
          The link may be mistyped, or the card hasn&apos;t been sent yet.
        </p>
      </div>
    );
  }

  const greeting = OCCASION_GREETINGS[page.occasionType] ?? "A message for you";
  const hasContent = page.message || page.emoji || page.videoUrl;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-14 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        {page.emoji && <div className="text-6xl leading-none sm:text-7xl">{page.emoji}</div>}
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {greeting}, {page.recipientFirstName}
        </h1>

        {page.videoUrl && (
          <video
            controls
            playsInline
            src={page.videoUrl}
            className="aspect-video w-full rounded-xl border border-border bg-black/5 shadow-sm"
          />
        )}

        {page.message && (
          <p className="w-full whitespace-pre-wrap text-lg leading-relaxed text-foreground/80">
            {page.message}
          </p>
        )}

        {!hasContent && (
          <p className="text-muted">
            Your card is on its way — a personal message will appear here soon.
          </p>
        )}
      </div>

      <div className="mt-6 flex items-center gap-1.5 text-xs text-muted">
        <span className="font-semibold text-foreground/70">Kudos Cards</span>
        <span aria-hidden>·</span>
        <span>Recognition, delivered</span>
      </div>
    </div>
  );
}
