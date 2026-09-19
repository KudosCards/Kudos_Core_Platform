import { render, screen } from "@testing-library/react";
import { MessagePageView } from "./message-page-view";

/**
 * A recipient scans the QR code on a printed card, opens the message page, and
 * the video is the thing they were sent. It was showing:
 *
 *     Error 153 — Video player configuration error
 *
 * YouTube's embedded player refuses to configure itself when it cannot see a
 * referrer, and the message page sends `Referrer-Policy: no-referrer`
 * (proxy.ts). That header is right for a page addressed to one named person; it
 * just has to not apply to this one request.
 */
describe("MessagePageView — the video embed", () => {
  /** Every field on the props is required, so this names them once. */
  const page = {
    emoji: "\u{1F389}",
    title: "Happy Birthday!",
    greetingName: "Matthew",
    embedUrl: null,
    videoUrl: null,
    messageHtml: null,
    ctaLabel: null,
    ctaUrl: null,
  };

  function renderWithEmbed(embedUrl = "https://www.youtube-nocookie.com/embed/abc123") {
    render(<MessagePageView {...page} embedUrl={embedUrl} />);
    return screen.getByTitle("Message video");
  }

  it("overrides the page's no-referrer policy, or the video will not play", () => {
    // An element-level referrerpolicy overrides the document's for that
    // element's fetch, so the override is as narrow as the problem.
    expect(renderWithEmbed()).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  });

  it("sends the origin and never the path", () => {
    // The path is /r/<slug>, and that slug is the page's whole secret — anyone
    // holding it can read a message meant for somebody else. These are the
    // policies that would file it in YouTube's logs.
    const policy = renderWithEmbed().getAttribute("referrerpolicy");
    expect(policy).not.toBe("unsafe-url");
    expect(policy).not.toBe("no-referrer-when-downgrade");
    expect(policy).not.toBe("origin-when-cross-origin");
  });

  it("still refuses to be framed by anything else it renders", () => {
    // The embed is a frame we open, not one we accept: nothing here should
    // start allowing this page into somebody else's.
    const iframe = renderWithEmbed();
    expect(iframe).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/abc123");
    expect(iframe).toHaveAttribute("allowfullscreen");
  });

  it("falls back to an uploaded video when there is no embed", () => {
    render(<MessagePageView {...page} videoUrl="https://storage.test/video.mp4" />);
    expect(screen.queryByTitle("Message video")).toBeNull();
  });
});
