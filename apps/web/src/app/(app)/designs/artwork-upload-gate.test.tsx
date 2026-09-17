import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { idealArtworkPixels } from "@kudos/shared-types";
import { DesignsClient } from "./designs-client";

const post = jest.fn();
const measured = jest.fn();

jest.mock("@/lib/api.client", () => ({ clientApiFetch: (...a: unknown[]) => post(...a) }));
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: () => Promise.resolve({ error: null }) }) },
  }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
// jsdom never decodes an image, so the real helper would resolve null forever.
jest.mock("@/lib/image-natural-size", () => ({
  readFileNaturalSize: () => measured(),
  loadNaturalSize: () => Promise.resolve(null),
}));

/**
 * The browser half of the artwork gate. The server refuses the same artwork at
 * the save, so this is not the guarantee — it is the half that tells a customer
 * while the file is still on their machine and nothing has been uploaded.
 * See ADR 0248.
 */
describe("Upload your own artwork", () => {
  const pick = async () => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "art.png", { type: "image/png" }));
  };

  const view = () =>
    render(<DesignsClient templates={[]} initialSavedDesigns={[]} customArtworkEnabled />);

  beforeEach(() => {
    post.mockReset();
    measured.mockReset();
    post.mockResolvedValue({ id: "d1", path: "p", token: "t", publicUrl: "https://x/u/a.png" });
  });

  it("refuses wrong-shaped artwork without uploading anything", async () => {
    measured.mockResolvedValue({ width: 1240, height: 1860 });
    view();

    await pick();

    expect(await screen.findByText(/not the card's shape/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("names the size to export at, so the refusal is actionable", async () => {
    measured.mockResolvedValue({ width: 1240, height: 1860 });
    view();

    await pick();

    expect(await screen.findByText(/1240 × 1748 pixels/)).toBeInTheDocument();
  });

  it("uploads artwork that is the right shape", async () => {
    measured.mockResolvedValue(idealArtworkPixels("A6"));
    view();

    await pick();

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(screen.queryByText(/not the card's shape/)).not.toBeInTheDocument();
  });

  it("uploads when the file cannot be measured, rather than refusing it", async () => {
    // Unmeasurable is not wrong. The server gate fails open for the same reason,
    // and refusing here would block an upload because *we* could not read it.
    measured.mockResolvedValue(null);
    view();

    await pick();

    await waitFor(() => expect(post).toHaveBeenCalled());
  });
});
