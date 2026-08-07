import { parseVideoEmbed } from "@kudos/shared-types";

/** Unit tests for the shared message-page video embed parser (ADR 0132). Lives
 * in the API's jest suite (the shared-types package has no runner), mirroring
 * design-layout.spec.ts / merge-tokens.spec.ts. */
describe("parseVideoEmbed", () => {
  it("recognises YouTube in all its URL shapes → nocookie embed", () => {
    const cases = [
      "https://www.youtube.com/watch?v=HgzGwKwLmgM",
      "https://youtube.com/watch?v=HgzGwKwLmgM&t=42",
      "https://youtu.be/HgzGwKwLmgM",
      "https://www.youtube.com/shorts/HgzGwKwLmgM",
      "https://www.youtube.com/embed/HgzGwKwLmgM",
    ];
    for (const url of cases) {
      expect(parseVideoEmbed(url)).toEqual({
        provider: "youtube",
        videoId: "HgzGwKwLmgM",
        embedUrl: "https://www.youtube-nocookie.com/embed/HgzGwKwLmgM",
      });
    }
  });

  it("recognises Vimeo (plain + player)", () => {
    expect(parseVideoEmbed("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      videoId: "123456789",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
    expect(parseVideoEmbed("https://player.vimeo.com/video/123456789")).toMatchObject({
      provider: "vimeo",
      videoId: "123456789",
    });
  });

  it("recognises Loom (share + embed)", () => {
    expect(parseVideoEmbed("https://www.loom.com/share/0123456789abcdef")).toEqual({
      provider: "loom",
      videoId: "0123456789abcdef",
      embedUrl: "https://www.loom.com/embed/0123456789abcdef",
    });
  });

  it("recognises Google Drive (file + open?id)", () => {
    const id = "1AbCdEfGhIjKlMnOpQr";
    expect(parseVideoEmbed(`https://drive.google.com/file/d/${id}/view?usp=sharing`)).toEqual({
      provider: "google_drive",
      videoId: id,
      embedUrl: `https://drive.google.com/file/d/${id}/preview`,
    });
    expect(parseVideoEmbed(`https://drive.google.com/open?id=${id}`)).toMatchObject({
      provider: "google_drive",
      videoId: id,
    });
  });

  it("rejects anything not on the allowlist or not a real video URL", () => {
    expect(parseVideoEmbed("")).toBeNull();
    expect(parseVideoEmbed("   ")).toBeNull();
    expect(parseVideoEmbed("not a url")).toBeNull();
    expect(parseVideoEmbed("javascript:alert(1)")).toBeNull();
    expect(parseVideoEmbed("https://evil.example.com/embed/hack")).toBeNull();
    // A lookalike host must not pass (endsWith guard, not substring).
    expect(parseVideoEmbed("https://youtube.com.evil.com/watch?v=HgzGwKwLmgM")).toBeNull();
    // Right host, but no id.
    expect(parseVideoEmbed("https://www.youtube.com/")).toBeNull();
    expect(parseVideoEmbed("https://vimeo.com/channels/staffpicks")).toBeNull();
  });

  it("accepts a subdomain of an allowed host", () => {
    expect(parseVideoEmbed("https://m.youtube.com/watch?v=HgzGwKwLmgM")).toMatchObject({
      provider: "youtube",
    });
  });
});
