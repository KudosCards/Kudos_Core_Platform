import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnterpriseContactForm } from "./enterprise-contact-client";

const post = jest.fn();
jest.mock("@/lib/api.public", () => ({
  publicApiPost: (...args: unknown[]) => post(...args),
}));

/**
 * The client half of the Enterprise spam gate.
 *
 * The server cannot catch a bot on its own: the honeypot has to be in the DOM
 * and the open-time has to be sent. Both are invisible, so a refactor could drop
 * either one and every other test would still pass while the gate quietly did
 * nothing. That is what these are for. See ADR 0244.
 */
describe("EnterpriseContactForm", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ id: "e-1", status: "new" });
  });

  async function fillAndSubmit() {
    await userEvent.type(screen.getByLabelText(/Your name/), "Dana Ops");
    await userEvent.type(screen.getByLabelText(/Work email/), "dana@bigtutoring.example");
    await userEvent.type(screen.getByLabelText(/Organisation/), "Big Tutoring Group");
    await userEvent.type(screen.getByLabelText(/What are you looking for/), "Three centres.");
    await userEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
  }

  it("puts a honeypot in the DOM that no real visitor can reach", () => {
    const { container } = render(<EnterpriseContactForm />);

    const honeypot = container.querySelector('input[name="contactReference"]');
    expect(honeypot).not.toBeNull();
    // Out of the tab order and out of the accessibility tree, so the only thing
    // that ever fills it is something reading the raw HTML.
    expect(honeypot).toHaveAttribute("tabIndex", "-1");
    expect(honeypot).toHaveAttribute("autoComplete", "off");
    expect(honeypot?.closest("[aria-hidden='true']")).not.toBeNull();
    // Absent from the accessibility tree, while the real fields are present in
    // it — so this is the honeypot being hidden, not the query finding nothing.
    expect(screen.getByRole("textbox", { name: /Organisation/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /Leave this field empty/ }),
    ).not.toBeInTheDocument();
  });

  it("sends the honeypot and the open-time, so the server can judge", async () => {
    render(<EnterpriseContactForm />);
    await fillAndSubmit();

    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    // Empty, which is what a person submits — the server only acts on content.
    expect(body.contactReference).toBe("");
    expect(typeof body.formOpenedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.formOpenedAt as string))).toBe(false);
  });

  it("times from when the form opened, not from when it was submitted", async () => {
    render(<EnterpriseContactForm />);
    const openedBefore = Date.now();
    await fillAndSubmit();

    const body = post.mock.calls[0][1] as { formOpenedAt: string };
    // A timestamp taken at submit would be indistinguishable from "now" and the
    // timing rule would never fire. It must predate the submission.
    expect(Date.parse(body.formOpenedAt)).toBeLessThanOrEqual(openedBefore);
  });

  it("still thanks the visitor — the gate is invisible from out here", async () => {
    render(<EnterpriseContactForm />);
    await fillAndSubmit();

    expect(await screen.findByText(/we’ll be in touch/i)).toBeInTheDocument();
  });
});
