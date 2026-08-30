import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
}));

import AppError from "./(app)/error";
import OpsError from "./(ops)/error";
import AuthError from "./(auth)/error";
import PublicError from "./error";
import GlobalError from "./global-error";

/**
 * `serverApiFetch` throws on any non-2xx, so an API 5xx while a page loads is a
 * render error. Only `(app)` had a boundary: an operator hitting a 5xx on
 * /fulfillment, or a visitor on a marketing page, was dropped onto Next's bare
 * default error screen — no branding, no retry, and nothing reported to Sentry.
 * See ADR 0206.
 */
describe("error boundaries", () => {
  const error = Object.assign(new Error("boom"), { digest: "abc123" });

  beforeEach(() => captureException.mockReset());

  const boundaries = [
    ["the authenticated app", AppError],
    ["the ops area", OpsError],
    ["the sign-in flow", AuthError],
    ["the public site", PublicError],
    ["the root layout", GlobalError],
  ] as const;

  it.each(boundaries)("%s offers a way out and reports the error", async (_name, Boundary) => {
    const reset = jest.fn();
    render(<Boundary error={error} reset={reset} />);

    // Something a person can read, and something they can press.
    expect(screen.getByRole("heading")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /try again/i });
    await userEvent.click(retry);
    expect(reset).toHaveBeenCalled();

    // And the failure reaches Sentry — a boundary that swallows the error
    // silently is worse than the bare screen, which at least looks broken.
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
