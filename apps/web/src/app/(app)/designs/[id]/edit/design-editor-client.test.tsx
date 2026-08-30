import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignEditorClient } from "./design-editor-client";
import type { SavedDesign } from "@kudos/shared-types";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
const uploadToSignedUrl = jest.fn();
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}));
jest.mock("./design-canvas", () => ({ DesignCanvas: () => <div data-testid="canvas" /> }));

/**
 * `handleImageUpload` awaits a signed URL, the file's dimensions and the upload
 * itself, then calls `insertImage` — which read `activePage` from the render the
 * click happened in. Switch face while a large photo uploads and the image is
 * placed on the face you left, and selected there: the properties panel reads
 * "Nothing selected" and the image is nowhere on screen, with nothing to say
 * where it went. See ADR 0205.
 */
describe("DesignEditorClient — switching face during an upload", () => {
  const design = {
    id: "d-1",
    name: "Happy Birthday",
    document: {
      pages: [
        { name: "front", elements: [] },
        { name: "inside-left", elements: [] },
        { name: "inside-right", elements: [] },
        { name: "back", elements: [] },
      ],
    },
  } as unknown as SavedDesign;

  let releaseUpload!: (value: unknown) => void;

  beforeEach(() => {
    fetchMock.mockReset();
    uploadToSignedUrl.mockReset();
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (String(url).includes("/uploads/design-assets")) {
        return Promise.resolve({
          path: "p",
          token: "t",
          publicUrl: "https://cdn.test/photo.png",
        });
      }
      // GET /design-assets seeds the "Your uploads" library (an array); the
      // POST that records a new one answers with the single asset.
      if (init?.method === "POST") return Promise.resolve({ id: "a-1", fileName: "photo.png" });
      return Promise.resolve([]);
    });
    // jsdom never loads an <img>, so readImageSize would hang forever. Resolve
    // it the way a real browser does for a readable file.
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:x" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 300;
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    Object.defineProperty(window, "Image", { configurable: true, value: StubImage });

    // Hold the storage upload open so the face can be switched mid-flight.
    uploadToSignedUrl.mockImplementation(() => new Promise((resolve) => (releaseUpload = resolve)));
  });

  it("puts the image on the face it was added from, and shows that face", async () => {
    render(
      <DesignEditorClient savedDesign={design} messagePages={[]} canAuthorMessagePages={false} />,
    );

    // Start on the front and add a photo.
    const file = new File(["x"], "photo.png", { type: "image/png" });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await waitFor(() => expect(uploadToSignedUrl).toHaveBeenCalled());

    // Switch to the back while it uploads.
    await userEvent.click(screen.getByRole("button", { name: "back" }));

    await act(async () => {
      releaseUpload({ error: null });
      await Promise.resolve();
    });

    // The image belongs on the face it was added from — and the editor shows
    // that face, so the person who asked for it can see it arrive, selected and
    // ready to move. The reported symptom is the properties panel reading
    // "Nothing selected" beside an image nowhere on screen.
    await waitFor(() => expect(screen.getByText("Selected element")).toBeInTheDocument());
    expect(screen.queryByText("Nothing selected")).not.toBeInTheDocument();

    // And it really is on the front: stepping to the back shows nothing
    // selected there, because the image was never placed on it.
    await userEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
  });
});
