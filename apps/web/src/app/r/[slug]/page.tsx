import { env } from "@/lib/env";
import { MessagePageView } from "@/components/message-page-view";
import { ReplyForm } from "./reply-form";

/**
 * Public QR-linked digital message page — no login, no app required. The
 * physical card posted to a recipient carries a QR code that resolves here.
 * Fetches the public GET /messages/:slug endpoint directly (no auth token);
 * that endpoint counts the view and returns only the safe public fields —
 * never account, order, or address data (ADR 0132). An archived page returns
 * `available: false` and degrades to a graceful notice rather than a 404, so a
 * card already in the post never dead-ends.
 */

interface PublicMessagePage {
  available: boolean;
  title: string | null;
  message: string | null;
  emoji: string | null;
  videoType: "none" | "embed" | "upload";
  embedUrl: string | null;
  videoUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  allowReplies: boolean;
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-14 text-center">
      {children}
      <div className="mt-6 flex items-center gap-1.5 text-xs text-muted">
        <span className="font-semibold text-foreground/70">Kudos Cards</span>
        <span aria-hidden>·</span>
        <span>Recognition, delivered</span>
      </div>
    </div>
  );
}

export default async function MessagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await fetchMessagePage(slug);

  if (!page) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-semibold">This message couldn&apos;t be found</p>
          <p className="max-w-sm text-muted">
            The link may be mistyped, or the card hasn&apos;t been sent yet.
          </p>
        </div>
      </Shell>
    );
  }

  if (!page.available) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3">
          <div className="text-5xl leading-none">💌</div>
          <p className="text-lg font-semibold">This message is no longer available</p>
          <p className="max-w-sm text-muted">
            The sender has taken this page down. We hope you enjoyed your card
            {page.recipientFirstName !== "there" ? `, ${page.recipientFirstName}` : ""}.
          </p>
        </div>
      </Shell>
    );
  }

  // The author's title leads; if they left it blank we fall back to an
  // occasion-appropriate greeting so the page never opens headless.
  const fallbackGreeting = OCCASION_GREETINGS[page.occasionType] ?? "A message for you";
  const title = page.title ?? `${fallbackGreeting}, ${page.recipientFirstName}`;

  return (
    <Shell>
      <MessagePageView
        emoji={page.emoji}
        title={title}
        greetingName={page.title ? page.recipientFirstName : null}
        embedUrl={page.embedUrl}
        videoUrl={page.videoUrl}
        messageHtml={page.message}
        ctaLabel={page.ctaLabel}
        ctaUrl={page.ctaUrl}
        ctaHref={
          page.ctaUrl
            ? `${env.NEXT_PUBLIC_API_URL}/messages/${encodeURIComponent(slug)}/cta`
            : null
        }
      />
      {page.allowReplies && <ReplyForm slug={slug} />}
    </Shell>
  );
}
