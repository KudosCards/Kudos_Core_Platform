import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DesignDocument } from "@kudos/shared-types";
import { SendCardClient } from "./send-card-client";

jest.mock("@/lib/api.client", () => ({ clientApiFetch: () => Promise.resolve({ items: [] }) }));

/**
 * Phase 3 of docs/card-message-guardrails-plan.md, on the single-card path.
 *
 * This is the flow a school actually uses one pupil at a time, reusing the same
 * saved design — which is how a card came to greet the previous recipient. The
 * server refuses it; this is the half the sender can act on.
 */
function designSaying(text: string): DesignDocument {
  return {
    pages: ["front", "inside-left", "inside-right", "back"].map((name) => ({
      name,
      elements:
        name === "inside-right"
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
    })),
  } as unknown as DesignDocument;
}

function renderSend(text: string) {
  return render(
    <SendCardClient
      designId="d1"
      designName="Happy Tulips"
      designDocument={designSaying(text)}
      messagePages={[]}
      canAuthorMessagePages={false}
    />,
  );
}

/** The desktop Pay button — the mobile bar renders a second one. */
function payButtons() {
  return screen.getAllByRole("button", { name: /Pay &/ });
}

describe("single-card send, a design that greets somebody by hand", () => {
  it("will not pay until the sender confirms the name", async () => {
    const user = userEvent.setup();
    renderSend("To Florence,\n\nWell done!");

    // Nothing is said before a recipient is typed: with nobody to compare
    // against, "To Florence," is not yet wrong for anyone.
    expect(screen.queryByText(/This design says/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("First name"), "Elise");

    expect(screen.getByText(/This design says “Florence” on the inside right/)).toBeInTheDocument();
    for (const button of payButtons()) expect(button).toBeDisabled();

    // Choose the timing, so the only thing left holding the send is the name.
    await user.click(screen.getByRole("radio", { name: /As soon as possible/ }));
    for (const button of payButtons()) expect(button).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /Florence/ }));

    for (const button of payButtons()) expect(button).toBeEnabled();
  });

  it("says nothing about a card addressed with a merge field", async () => {
    const user = userEvent.setup();
    renderSend("To {firstName}\n\nWell done!");

    await user.type(screen.getByLabelText("First name"), "Elise");

    expect(screen.queryByText(/This design says/)).not.toBeInTheDocument();
  });

  it("says nothing when the card greets its own recipient", async () => {
    const user = userEvent.setup();
    renderSend("Dear Florence,\n\nWell done!");

    await user.type(screen.getByLabelText("First name"), "florence");

    expect(screen.queryByText(/This design says/)).not.toBeInTheDocument();
  });
});
