import { render, screen } from "@testing-library/react";
import { TruncationNotice } from "./truncation-notice";

/**
 * A list that ends without saying so reads as the whole truth.
 *
 * A school reported their calendar month "stopping" on 17 September; it was
 * drawing one page of a hundred and saying nothing (ADR 0173). Six more screens
 * were doing the same. The rule is: silence only when everything fits.
 */
describe("TruncationNotice", () => {
  it("says how much is being withheld, and how to reach it", () => {
    render(
      <TruncationNotice
        shown={100}
        total={1372}
        unit="waiting for approval"
        hint="Approve or skip some to see the rest."
      />,
    );
    expect(
      screen.getByText(/Showing the first 100 of 1,372 waiting for approval/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Approve or skip some to see the rest/)).toBeInTheDocument();
  });

  it("says nothing when the list is complete", () => {
    // The ordinary case. A notice on every full list would train people to
    // ignore it, which costs exactly as much as never showing it.
    const { container } = render(<TruncationNotice shown={50} total={50} unit="orders" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing when the list is under the cap", () => {
    const { container } = render(<TruncationNotice shown={7} total={7} unit="tickets" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is silent rather than wrong if a caller passes a total below what it drew", () => {
    // Defensive: `total` comes from a separate count on the API and could lag
    // the page by a row. Claiming "the first 10 of 4" would be worse than
    // saying nothing.
    const { container } = render(<TruncationNotice shown={10} total={4} unit="orders" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("groups thousands, because these numbers get large", () => {
    render(<TruncationNotice shown={1000} total={12345} unit="events" />);
    expect(screen.getByText(/1,000 of 12,345/)).toBeInTheDocument();
  });
});
