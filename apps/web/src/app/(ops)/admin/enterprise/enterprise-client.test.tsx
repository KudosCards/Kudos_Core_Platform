import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EnterpriseEnquiry } from "@kudos/shared-types";
import { EnterpriseLeadsClient } from "./enterprise-client";

const patch = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => patch(...args),
}));

/**
 * The ops side of the Enterprise spam gate.
 *
 * The gate is allowed to be wrong — that is the trade for never rejecting a
 * submission outright — which only holds if ops can see *why* a lead was held
 * and put it back in one click. These test that, not the styling. See ADR 0244.
 */
describe("EnterpriseLeadsClient", () => {
  const lead = (over: Partial<EnterpriseEnquiry> = {}): EnterpriseEnquiry => ({
    id: "lead-1",
    name: "Dana Ops",
    email: "dana@bigtutoring.example",
    organisation: "Big Tutoring Group",
    phone: null,
    teamSize: null,
    message: "We run three centres and want cards handled centrally.",
    status: "new",
    spamReason: null,
    createdAt: new Date("2026-09-16T09:00:00.000Z"),
    ...over,
  });

  beforeEach(() => {
    patch.mockReset();
  });

  it("says in plain English why a lead was held", async () => {
    render(
      <EnterpriseLeadsClient
        initialItems={[lead({ status: "spam", spamReason: "message-has-no-words" })]}
      />,
    );

    expect(await screen.findByText(/the message had no words in it/)).toBeInTheDocument();
  });

  it("falls back to the raw reason rather than saying nothing", async () => {
    // A rule added to the API before this map catches up must still explain
    // itself, badly, rather than leave ops staring at an unexplained lead.
    render(
      <EnterpriseLeadsClient
        initialItems={[lead({ status: "spam", spamReason: "some-new-rule" })]}
      />,
    );

    expect(await screen.findByText(/some-new-rule/)).toBeInTheDocument();
  });

  it("restores a held lead to the queue in one click", async () => {
    patch.mockResolvedValue(lead({ status: "new", spamReason: null }));
    render(
      <EnterpriseLeadsClient initialItems={[lead({ status: "spam", spamReason: "honeypot" })]} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Not spam" }));

    expect(patch).toHaveBeenCalledWith(
      "/admin/enterprise-enquiries/lead-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "new" }) }),
    );
    // And the row reflects it, so ops aren't left guessing whether it worked.
    expect(await screen.findByText("New")).toBeInTheDocument();
    expect(screen.queryByText(/Held by the spam filter/)).not.toBeInTheDocument();
  });

  it("lets ops bin a lead the gate missed", async () => {
    patch.mockResolvedValue(lead({ status: "spam", spamReason: null }));
    render(<EnterpriseLeadsClient initialItems={[lead()]} />);

    await userEvent.click(screen.getByRole("button", { name: "Spam" }));

    expect(patch).toHaveBeenCalledWith(
      "/admin/enterprise-enquiries/lead-1",
      expect.objectContaining({ body: JSON.stringify({ status: "spam" }) }),
    );
  });

  it("shows no spam notice on an ordinary lead", async () => {
    render(<EnterpriseLeadsClient initialItems={[lead()]} />);

    // Gated on the card having rendered, so the absence below means something.
    expect(await screen.findByText("Big Tutoring Group")).toBeInTheDocument();
    expect(screen.queryByText(/Held by the spam filter/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not spam" })).not.toBeInTheDocument();
  });

  it("keeps the lead's own details visible while it is held", async () => {
    // Nothing is lost: a held lead is still a lead, and ops can read it.
    render(
      <EnterpriseLeadsClient
        initialItems={[lead({ status: "spam", spamReason: "honeypot", message: "8838149310" })]}
      />,
    );

    const card = (await screen.findByText("Big Tutoring Group")).closest("div.rounded-xl");
    expect(within(card as HTMLElement).getByText("8838149310")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("dana@bigtutoring.example")).toBeInTheDocument();
  });
});
