import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavedDesign } from "@kudos/shared-types";
import { DesignEditorClient } from "./design-editor-client";

jest.mock("@/lib/api.client", () => ({ clientApiFetch: () => Promise.resolve({}) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: jest.fn() }) } }),
}));
jest.mock("./design-canvas", () => ({ DesignCanvas: () => <div data-testid="canvas" /> }));

/**
 * Phase 1 of docs/card-message-guardrails-plan.md: say it where it is typed.
 *
 * Kip McGrath addressed a card to Florence by typing her name, then reused the
 * design for Elise. Every guard we had spoke at checkout, after an entire send
 * had been built — `salutationNames` was used in exactly one place, and it was
 * not here. The editor is the only surface where the fix costs one click and
 * nothing has been bought.
 */
function designSaying(text: string, face = "inside-right"): SavedDesign {
  const page = (name: string) => ({
    name,
    elements:
      name === face
        ? [
            {
              kind: "text",
              id: "t1",
              text,
              x: 40,
              y: 40,
              width: 300,
              fontSize: 18,
              fontFamily: "inter",
              color: "#000000",
              rotation: 0,
            },
          ]
        : [],
  });
  return {
    id: "d-1",
    name: "Happy Tulips copy",
    document: {
      pages: [page("front"), page("inside-left"), page("inside-right"), page("back")],
    },
  } as unknown as SavedDesign;
}

const open = (design: SavedDesign) =>
  render(
    <DesignEditorClient savedDesign={design} messagePages={[]} canAuthorMessagePages={false} />,
  );

describe("DesignEditorClient — a person named by hand", () => {
  it("names the person and points at the field that fixes it", async () => {
    open(designSaying("To Florence,\n\nHappy Birthday!"));
    await userEvent.click(screen.getByRole("button", { name: "inside-right" }));

    const note = await screen.findByText(/says .Florence. by hand/);
    expect(note).toHaveTextContent(/First name/);
  });

  it("says nothing about the correct way to write it", async () => {
    // The falsifying check. A guard that fires on `To {firstName},` — the thing
    // we are asking people to do — is a guard that gets ignored within a day.
    // Merge tokens are stripped before matching, so there is no name left.
    open(designSaying("To {firstName},\n\nHappy Birthday!"));
    await userEvent.click(screen.getByRole("button", { name: "inside-right" }));
    await waitFor(() => expect(screen.getByTestId("canvas")).toBeInTheDocument());

    expect(screen.queryByText(/by hand/)).not.toBeInTheDocument();
  });

  it("says nothing about a relationship word", async () => {
    // "Dear Team," names nobody. NOT_A_NAME already carries these, and the
    // editor must inherit that judgement rather than form a second opinion.
    open(designSaying("Dear Team,\n\nWell done!"));
    await userEvent.click(screen.getByRole("button", { name: "inside-right" }));
    await waitFor(() => expect(screen.getByTestId("canvas")).toBeInTheDocument());

    expect(screen.queryByText(/by hand/)).not.toBeInTheDocument();
  });

  it("speaks about the face being edited, not another one", async () => {
    // The discriminator, with its own positive signal: silent on the front,
    // and the same render then moves to the face that carries the name.
    open(designSaying("To Florence,\n\nHappy Birthday!"));
    await waitFor(() => expect(screen.getByTestId("canvas")).toBeInTheDocument());
    expect(screen.queryByText(/by hand/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "inside-right" }));
    expect(await screen.findByText(/says .Florence. by hand/)).toBeInTheDocument();
  });

  it("does not mistake a sentence that happens to contain a preposition", async () => {
    // SALUTATION_LINE matches a line that is *only* a salutation. "Welcome to
    // Kip" is prose, and flagging it would teach people to ignore the warning.
    open(designSaying("Welcome to Kip\n\nWe are glad you are here."));
    await userEvent.click(screen.getByRole("button", { name: "inside-right" }));
    await waitFor(() => expect(screen.getByTestId("canvas")).toBeInTheDocument());

    expect(screen.queryByText(/by hand/)).not.toBeInTheDocument();
  });
});
