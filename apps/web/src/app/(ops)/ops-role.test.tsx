import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpsRoleProvider, SuperAdminEditable, SuperAdminOnly } from "./ops-role";
import { PrintSizeSetup } from "./admin/print-size-setup";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));

/**
 * `super-admin-controls.test.ts` pins that every control naming a super-admin
 * route is gated. This is the other half: that the gate does anything.
 *
 * A scan can only see that the wrapper is written down. What an ops operator
 * experiences is whether the button moves — so this presses it.
 */
describe("the ops role gates", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ size: "A5", default: "A5" });
  });

  describe("SuperAdminEditable", () => {
    function panel(role: "super_admin" | "ops") {
      return render(
        <OpsRoleProvider role={role}>
          <SuperAdminEditable>
            <button type="button" onClick={() => fetchMock("pressed")}>
              Save
            </button>
          </SuperAdminEditable>
        </OpsRoleProvider>,
      );
    }

    it("leaves a super admin's controls alone, and says nothing", () => {
      panel("super_admin");
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      expect(screen.queryByText(/super admins only/i)).not.toBeInTheDocument();
    });

    it("makes an ops operator's controls inert, and explains why", async () => {
      panel("ops");
      const save = screen.getByRole("button", { name: "Save" });
      expect(save).toBeDisabled();
      expect(screen.getByText(/super admins only/i)).toBeInTheDocument();

      // Not just styled as disabled — pressing it does nothing. The whole point
      // is that the request is never sent, so there is no 403 to read.
      await userEvent.click(save);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails closed with no provider at all", () => {
      render(
        <SuperAdminEditable>
          <button type="button">Save</button>
        </SuperAdminEditable>,
      );
      // A permission gate that unlocks itself when its context goes missing is
      // worse than one that is occasionally too strict.
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });

  describe("SuperAdminOnly", () => {
    it("renders for a super admin and not for an ops operator", () => {
      const { rerender } = render(
        <OpsRoleProvider role="super_admin">
          <SuperAdminOnly>
            <button type="button">Run backfill</button>
          </SuperAdminOnly>
        </OpsRoleProvider>,
      );
      expect(screen.getByRole("button", { name: "Run backfill" })).toBeInTheDocument();

      rerender(
        <OpsRoleProvider role="ops">
          <SuperAdminOnly>
            <button type="button">Run backfill</button>
          </SuperAdminOnly>
        </OpsRoleProvider>,
      );
      expect(screen.queryByRole("button", { name: "Run backfill" })).not.toBeInTheDocument();
    });
  });

  describe("a real panel", () => {
    it("still shows an ops operator the setting, but will not let them change it", async () => {
      render(
        <OpsRoleProvider role="ops">
          <PrintSizeSetup />
        </OpsRoleProvider>,
      );

      // The value is still readable — seeing the configuration is an operator's
      // job, which is why the API leaves the read route unrestricted.
      await waitFor(() => expect(screen.getByRole("button", { name: "A5" })).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "A6" })).toBeDisabled();

      fetchMock.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "A6" }));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("lets a super admin change it", async () => {
      render(
        <OpsRoleProvider role="super_admin">
          <PrintSizeSetup />
        </OpsRoleProvider>,
      );

      await waitFor(() => expect(screen.getByRole("button", { name: "A6" })).toBeEnabled());
      fetchMock.mockResolvedValue({ size: "A6" });
      await userEvent.click(screen.getByRole("button", { name: "A6" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/admin/print/card-size",
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });
});
