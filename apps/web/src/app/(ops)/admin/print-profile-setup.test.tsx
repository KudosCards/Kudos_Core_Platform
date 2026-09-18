import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_PRINT_PROFILE, type PrintProfile } from "@kudos/shared-types";
import { PrintProfileSetup } from "./print-profile-setup";

const api = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => api(...args),
}));
jest.mock("../ops-role", () => ({
  SuperAdminEditable: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/**
 * The panel that gets the calibration numbers out of an operator's hand and into
 * the print engine.
 *
 * The arithmetic is the point. Four edge readings are two separate faults — an
 * enlargement the resize corrects, and a placement offset no resize can touch —
 * and reading them by hand is how the first real calibration was nearly acted on
 * as "shift it left and leave the size alone", which would have left 3.25 mm of
 * every design cut off each long edge. See ADR 0251.
 */
describe("PrintProfileSetup", () => {
  const loaded = (profile: PrintProfile = DEFAULT_PRINT_PROFILE) => {
    api.mockReset();
    api.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "PUT"
        ? Promise.resolve({ profile })
        : Promise.resolve({ profile, default: DEFAULT_PRINT_PROFILE }),
    );
  };

  /** Type the sheet's four readings into the panel. */
  async function enter(readings: { top: number; right: number; bottom: number; left: number }) {
    const user = userEvent.setup();
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      await user.type(screen.getByLabelText(new RegExp(`^${edge} `, "i")), String(readings[edge]));
    }
    return user;
  }

  it("turns the real calibration readings into the right three settings", async () => {
    // The print that finally engaged borderless: top 2, bottom 2, left 1.5,
    // right 5. That is a 3.25 mm enlargement per long edge plus the printer
    // placing the sheet 1.75 mm right of centre, and nothing vertical.
    loaded();
    render(<PrintProfileSetup />);
    await screen.findByText(/Borderless calibration/);

    await enter({ top: 2, right: 5, bottom: 2, left: 1.5 });

    const summary = await screen.findByText(/Enlargement/);
    expect(summary).toHaveTextContent("3.25 mm");
    expect(summary).toHaveTextContent("-1.75 mm");
  });

  it("saves the derived settings, not the readings", async () => {
    // The profile carries the printer's settled behaviour; the readings are one
    // print. Storing the readings would be storing the evidence, not the finding.
    loaded();
    render(<PrintProfileSetup />);
    await screen.findByText(/Borderless calibration/);

    const user = await enter({ top: 2, right: 5, bottom: 2, left: 1.5 });
    await user.click(await screen.findByRole("button", { name: /Save these settings/ }));

    await waitFor(() => {
      const put = api.mock.calls.find((call) => call[1]?.method === "PUT");
      expect(put).toBeDefined();
      expect(JSON.parse(put![1].body as string)).toMatchObject({
        borderlessOverhangMm: 3.25,
        borderlessOffsetXMm: -1.75,
        borderlessOffsetYMm: 0,
      });
    });
  });

  it("reads a vertical misplacement too, not just a sideways one", async () => {
    // Every reading from the real printer had top equal to bottom, so this axis
    // is the one a test can silently agree with by never exercising it. A
    // printer that drifts up the page is not a stranger thing than one that
    // drifts across it.
    loaded();
    render(<PrintProfileSetup />);
    await screen.findByText(/Borderless calibration/);

    await enter({ top: 4, right: 3, bottom: 1, left: 3 });

    const summary = await screen.findByText(/Enlargement/);
    expect(summary).toHaveTextContent("vertical 1.5 mm");
    expect(summary).toHaveTextContent("sideways 0 mm");
  });

  it("warns when the four readings cannot all be right", async () => {
    // A borderless pass enlarges evenly, so the long edges' loss predicts the
    // short edges'. A wide disagreement is a misread number, and saving it would
    // compensate for a printer that does not exist.
    loaded();
    render(<PrintProfileSetup />);
    await screen.findByText(/Borderless calibration/);

    await enter({ top: 0.5, right: 5, bottom: 0.5, left: 5 });

    expect(await screen.findByText(/one of the four readings is probably misread/)).toBeVisible();
  });

  it("stays quiet when the readings agree with each other", async () => {
    loaded();
    render(<PrintProfileSetup />);
    await screen.findByText(/Borderless calibration/);

    await enter({ top: 2, right: 5, bottom: 2, left: 1.5 });

    expect(screen.queryByText(/probably misread/)).not.toBeInTheDocument();
  });

  it("says plainly when nothing has been measured yet", async () => {
    // Zero is both "uncalibrated" and a legitimate setting, so the panel has to
    // distinguish them or an operator cannot tell whether the job is done.
    loaded();
    render(<PrintProfileSetup />);

    expect(await screen.findByText(/nothing measured yet/)).toBeVisible();
  });

  it("counts a perfectly centred printer as calibrated", async () => {
    // Zero offsets are the *right answer* for a printer that places the sheet
    // true. Treating "no offset" as "not measured" would tell an operator who
    // had just done the job that it still needed doing.
    loaded({ ...DEFAULT_PRINT_PROFILE, borderlessOverhangMm: 3.25 });
    render(<PrintProfileSetup />);

    await screen.findByText(/In force now/);
    expect(screen.queryByText(/nothing measured yet/)).not.toBeInTheDocument();
  });

  it("shows the settings in force once they are", async () => {
    loaded({
      ...DEFAULT_PRINT_PROFILE,
      borderlessOverhangMm: 3.25,
      borderlessOffsetXMm: -1.75,
    });
    render(<PrintProfileSetup />);

    const inForce = await screen.findByText(/In force now/);
    expect(inForce).toHaveTextContent("3.25 mm");
    expect(inForce).toHaveTextContent("-1.75 mm");
    expect(screen.queryByText(/nothing measured yet/)).not.toBeInTheDocument();
  });
});
