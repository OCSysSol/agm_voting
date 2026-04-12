import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoterBuildingCombobox } from "../VoterBuildingCombobox";
import type { BuildingOut } from "../../../api/voter";

const buildings: BuildingOut[] = [
  { id: "b1", name: "Alpha Tower" },
  { id: "b2", name: "Beta Court" },
  { id: "b3", name: "Sunset Towers" },
];

function renderCombobox(
  props: Partial<{
    buildings: BuildingOut[];
    value: string;
    onChange: (id: string) => void;
    error: string;
  }> = {}
) {
  const onChange = props.onChange ?? vi.fn();
  return {
    onChange,
    ...render(
      <VoterBuildingCombobox
        buildings={props.buildings ?? buildings}
        value={props.value ?? ""}
        onChange={onChange}
        error={props.error}
      />
    ),
  };
}

describe("VoterBuildingCombobox", () => {
  // --- Happy path ---

  it("renders a labelled input with role=combobox", () => {
    renderCombobox();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByLabelText("Select your building")).toBeInTheDocument();
  });

  it("shows placeholder text", () => {
    renderCombobox();
    expect(screen.getByPlaceholderText("Type to search buildings…")).toBeInTheDocument();
  });

  it("shows 'All buildings' option and all buildings on focus", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "All buildings" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alpha Tower" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta Court" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sunset Towers" })).toBeInTheDocument();
  });

  it("typing filters the buildings list (case-insensitive)", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.type(screen.getByRole("combobox"), "tower");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Alpha Tower" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Sunset Towers" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Beta Court" })).not.toBeInTheDocument();
    });
  });

  it("clicking an option calls onChange with building id", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Alpha Tower" }));
    expect(onChange).toHaveBeenCalledWith("b1");
  });

  it("selecting 'All buildings' calls onChange with empty string", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox({ value: "b1" });
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "All buildings" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("closes dropdown after selecting an option", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Alpha Tower" }));
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("shows selected building name as input text when value prop is set", () => {
    renderCombobox({ value: "b1" });
    expect(screen.getByRole("combobox")).toHaveValue("Alpha Tower");
  });

  // --- Error state ---

  it("shows error message when error prop is set", () => {
    renderCombobox({ error: "Please select a building" });
    expect(screen.getByRole("alert")).toHaveTextContent("Please select a building");
  });

  it("input has aria-invalid=true when error prop is set", () => {
    renderCombobox({ error: "Required" });
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("input has aria-invalid=false when no error", () => {
    renderCombobox();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "false");
  });

  // --- Keyboard navigation ---

  it("ArrowDown opens the dropdown if closed (via direct keydown event on unfocused input)", async () => {
    renderCombobox();
    const input = screen.getByRole("combobox");
    // Fire keydown without triggering onFocus first (so isOpen stays false)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
  });

  it("ArrowUp opens the dropdown if closed (via direct keydown event on unfocused input)", async () => {
    renderCombobox();
    const input = screen.getByRole("combobox");
    // Fire keydown without triggering onFocus first (so isOpen stays false)
    fireEvent.keyDown(input, { key: "ArrowUp" });
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
  });

  it("non-arrow keys when dropdown is closed do not open it (handleKeyDown early return)", async () => {
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox");
    // Fire a keydown event directly without focusing (so onFocus doesn't open dropdown)
    // When isOpen=false and key != ArrowDown/Up, handleKeyDown returns early
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ArrowDown navigates to first option", async () => {
    const user = userEvent.setup();
    renderCombobox();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("{ArrowDown}");
    // Active index should be 0 — aria-activedescendant should be set
    expect(input).toHaveAttribute("aria-activedescendant");
  });

  it("ArrowUp navigates to last option when activeIndex > 0", async () => {
    const user = userEvent.setup();
    renderCombobox();
    const input = screen.getByRole("combobox");
    await user.click(input);
    // ArrowDown twice to go to index 1
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    const afterDown = input.getAttribute("aria-activedescendant");
    // ArrowUp to go back to index 0
    await user.keyboard("{ArrowUp}");
    expect(input.getAttribute("aria-activedescendant")).not.toEqual(afterDown);
  });

  it("Enter selects the highlighted option", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("{ArrowDown}"); // highlight "All buildings" (index 0)
    await user.keyboard("{ArrowDown}"); // highlight "Alpha Tower" (index 1)
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("b1");
  });

  it("Enter does nothing when no option is highlighted (activeIndex=-1)", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox");
    await user.click(input);
    // No ArrowDown pressed — activeIndex is -1
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape closes the dropdown and restores previous text", async () => {
    const user = userEvent.setup();
    renderCombobox({ value: "b1" });
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.clear(input);
    await user.type(input, "xyz");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
    // Text restored to the building name matching value "b1"
    expect(input).toHaveValue("Alpha Tower");
  });

  it("clicking outside the combobox closes the dropdown", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // Click outside
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("restores input text to match current value when clicking outside", async () => {
    const user = userEvent.setup();
    renderCombobox({ value: "b2" });
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.clear(input);
    await user.type(input, "zzz");
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(input).toHaveValue("Beta Court");
    });
  });

  it("typing clears the value selection (calls onChange with empty string when value is set)", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox({ value: "b1" });
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "x");
    // onChange called with "" to deselect
    expect(onChange).toHaveBeenCalledWith("");
  });

  // --- Boundary values ---

  it("shows 'All buildings' only when input text matches nothing", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.type(screen.getByRole("combobox"), "zzzzzzzz");
    // No buildings match — only "All buildings" option appears
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "All buildings" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Alpha Tower" })).not.toBeInTheDocument();
    });
  });

  it("renders with empty buildings list without error", () => {
    renderCombobox({ buildings: [] });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows empty input text when value id has no matching building (getNameForId fallback)", () => {
    // value="unknown-id" not in buildings list → getNameForId returns "" via ?? ""
    renderCombobox({ value: "unknown-id" });
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("syncs inputText when value prop changes from parent", async () => {
    const { rerender } = renderCombobox({ value: "" });
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("");
    rerender(
      <VoterBuildingCombobox
        buildings={buildings}
        value="b2"
        onChange={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(input).toHaveValue("Beta Court");
    });
  });

  // --- Accessibility ---

  it("input has aria-expanded=false when closed", () => {
    renderCombobox();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("input has aria-expanded=true when dropdown is open", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");
  });

  it("selected option has aria-selected=true when dropdown opens", async () => {
    const user = userEvent.setup();
    // With value="b1", inputText="Alpha Tower". ArrowDown opens the dropdown.
    // Filter shows only options matching "Alpha Tower" -> ["All buildings", "Alpha Tower"]
    renderCombobox({ value: "b1" });
    const input = screen.getByRole("combobox");
    input.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    // "Alpha Tower" appears and has aria-selected=true (value="b1")
    const alphaOption = screen.getByRole("option", { name: "Alpha Tower" });
    expect(alphaOption).toHaveAttribute("aria-selected", "true");
  });
});
