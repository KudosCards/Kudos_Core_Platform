import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NameDialog } from "./name-dialog";

/**
 * Naming a list used to open `window.prompt`. The two things that dialog got
 * wrong — losing what you typed when the save failed, and having nowhere to put
 * the reason — are what these cover.
 */

function setup(props: Partial<React.ComponentProps<typeof NameDialog>> = {}) {
  const onSubmit = jest.fn();
  render(
    <NameDialog
      open
      title="New list"
      label="List name"
      onSubmit={onSubmit}
      onClose={jest.fn()}
      {...props}
    />,
  );
  return { onSubmit };
}

it("submits the trimmed name", () => {
  const { onSubmit } = setup();
  fireEvent.change(screen.getByLabelText("List name"), { target: { value: "  Year 4 class  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit).toHaveBeenCalledWith("Year 4 class");
});

it("won't submit an empty or whitespace-only name", () => {
  const { onSubmit } = setup();
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("List name"), { target: { value: "   " } });
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(onSubmit).not.toHaveBeenCalled();
});

it("keeps what you typed when the save is rejected, and says why against the field", () => {
  // The prompt version closed on submit, so a duplicate name came back as a
  // banner at the top of the page with the typed name already gone.
  const { rerender } = render(
    <NameDialog open title="New list" label="List name" onSubmit={jest.fn()} onClose={jest.fn()} />,
  );
  fireEvent.change(screen.getByLabelText("List name"), { target: { value: "Year 4 class" } });
  rerender(
    <NameDialog
      open
      title="New list"
      label="List name"
      error="You already have a list with that name"
      onSubmit={jest.fn()}
      onClose={jest.fn()}
    />,
  );

  const field = screen.getByLabelText("List name");
  expect(field).toHaveValue("Year 4 class");
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("You already have a list with that name")).toBeInTheDocument();
});

it("starts from the current name each time it opens, not the last one edited", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [target, setTarget] = useState("Year 4 class");
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <button
          onClick={() => {
            setTarget("Year 5 class");
            setOpen(true);
          }}
        >
          open other
        </button>
        <NameDialog
          open={open}
          title="Rename"
          label="List name"
          initialValue={target}
          onSubmit={jest.fn()}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }
  render(<Harness />);

  fireEvent.click(screen.getByRole("button", { name: "open" }));
  fireEvent.change(screen.getByLabelText("List name"), { target: { value: "abandoned edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  // Reopening on a different list must not carry the abandoned text over.
  fireEvent.click(screen.getByRole("button", { name: "open other" }));
  expect(screen.getByLabelText("List name")).toHaveValue("Year 5 class");
});
