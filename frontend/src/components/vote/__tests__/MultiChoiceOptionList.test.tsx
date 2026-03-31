import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiChoiceOptionList } from "../MultiChoiceOptionList";
import type { MotionOut } from "../../../api/voter";

const mcMotion: MotionOut = {
  id: "mot-mc-001",
  title: "Board Election",
  description: null,
  display_order: 1,
  motion_number: null,
  motion_type: "general",
  is_visible: true,
  already_voted: false,
  submitted_choice: null,
  option_limit: 2,
  options: [
    { id: "opt-1", text: "Alice", display_order: 1 },
    { id: "opt-2", text: "Bob", display_order: 2 },
    { id: "opt-3", text: "Carol", display_order: 3 },
  ],
};

describe("MultiChoiceOptionList", () => {
  // --- Happy path ---

  it("renders all options as checkboxes", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByLabelText("Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Bob")).toBeInTheDocument();
    expect(screen.getByLabelText("Carol")).toBeInTheDocument();
  });

  it("shows counter with 0 selected initially", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByTestId("mc-counter")).toHaveTextContent("0 selected");
    expect(screen.getByTestId("mc-counter")).toHaveTextContent("Select up to 2 options");
  });

  it("calls onSelectionChange with option id when unchecked option is clicked", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={onSelectionChange}
        disabled={false}
      />
    );
    await user.click(screen.getByLabelText("Alice"));
    expect(onSelectionChange).toHaveBeenCalledWith("mot-mc-001", ["opt-1"]);
  });

  it("calls onSelectionChange removing option id when checked option is unchecked", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={["opt-1", "opt-2"]}
        onSelectionChange={onSelectionChange}
        disabled={false}
      />
    );
    await user.click(screen.getByLabelText("Alice"));
    expect(onSelectionChange).toHaveBeenCalledWith("mot-mc-001", ["opt-2"]);
  });

  it("shows correct selection count when options are selected", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={["opt-1", "opt-2"]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByTestId("mc-counter")).toHaveTextContent("2 selected");
  });

  // --- Boundary values ---

  it("disables unchecked options when limit is reached", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={["opt-1", "opt-2"]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    // Carol is not selected — should be disabled since limit (2) is reached
    expect(screen.getByLabelText("Carol")).toBeDisabled();
    // Alice and Bob are checked — should remain enabled (so they can be unchecked)
    expect(screen.getByLabelText("Alice")).not.toBeDisabled();
    expect(screen.getByLabelText("Bob")).not.toBeDisabled();
  });

  it("does not disable options when limit is not reached", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={["opt-1"]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByLabelText("Alice")).not.toBeDisabled();
    expect(screen.getByLabelText("Bob")).not.toBeDisabled();
    expect(screen.getByLabelText("Carol")).not.toBeDisabled();
  });

  it("does not add option when limit is reached (checkbox is disabled)", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={["opt-1", "opt-2"]}
        onSelectionChange={onSelectionChange}
        disabled={false}
      />
    );
    // Carol is disabled when limit reached — click should be ignored
    await user.click(screen.getByLabelText("Carol"));
    // onChange not called because the checkbox is disabled
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("counter shows singular 'option' for option_limit=1", () => {
    const singleLimitMotion = { ...mcMotion, option_limit: 1 };
    render(
      <MultiChoiceOptionList
        motion={singleLimitMotion}
        selectedOptionIds={[]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByTestId("mc-counter")).toHaveTextContent("Select up to 1 option");
    expect(screen.getByTestId("mc-counter")).not.toHaveTextContent("options");
  });

  // --- State: disabled and readOnly ---

  it("all checkboxes are disabled when disabled=true", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={() => {}}
        disabled={true}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((cb) => expect(cb).toBeDisabled());
  });

  it("all checkboxes are disabled when readOnly=true", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={["opt-1"]}
        onSelectionChange={() => {}}
        disabled={false}
        readOnly={true}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((cb) => expect(cb).toBeDisabled());
  });

  it("does not call onSelectionChange when readOnly=true", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={onSelectionChange}
        disabled={false}
        readOnly={true}
      />
    );
    await user.click(screen.getByLabelText("Alice"));
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("does not call onSelectionChange when disabled=true", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={onSelectionChange}
        disabled={true}
      />
    );
    await user.click(screen.getByLabelText("Alice"));
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  // --- RR3-24: fieldset / legend ---

  it("wraps options in a fieldset element", () => {
    const { container } = render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    expect(container.querySelector("fieldset")).toBeInTheDocument();
  });

  it("renders a legend with the motion title", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={[]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByText("Board Election")).toBeInTheDocument();
    // Confirm it is inside a <legend>
    const legend = document.querySelector("legend");
    expect(legend).toBeInTheDocument();
    expect(legend?.textContent).toBe("Board Election");
  });

  // --- Edge cases ---

  it("handles null option_limit gracefully (falls back to options.length)", () => {
    const noLimitMotion = { ...mcMotion, option_limit: null };
    render(
      <MultiChoiceOptionList
        motion={noLimitMotion}
        selectedOptionIds={[]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    // Counter should use options.length (3) as fallback
    expect(screen.getByTestId("mc-counter")).toHaveTextContent("Select up to 3 options");
  });

  it("checked options show as checked", () => {
    render(
      <MultiChoiceOptionList
        motion={mcMotion}
        selectedOptionIds={["opt-1"]}
        onSelectionChange={() => {}}
        disabled={false}
      />
    );
    const aliceCheckbox = screen.getByLabelText("Alice") as HTMLInputElement;
    expect(aliceCheckbox.checked).toBe(true);
    const bobCheckbox = screen.getByLabelText("Bob") as HTMLInputElement;
    expect(bobCheckbox.checked).toBe(false);
  });
});
