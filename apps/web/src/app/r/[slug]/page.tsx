/**
 * Public QR-linked digital message page — no login, no app required.
 * Fetches by slug from the Messaging module (Phase 4). Placeholder route
 * shape only for now.
 */
export default async function MessagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-foreground/60">Message page</p>
      <p className="font-mono text-xs text-foreground/40">{slug}</p>
      <p className="max-w-sm text-foreground/70">
        This page will render the personalised video/text/emoji message once the QR message-page
        module (Phase 4) is built.
      </p>
    </div>
  );
}
