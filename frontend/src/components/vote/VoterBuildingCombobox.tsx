import { useState, useEffect, useRef, useId } from "react";
import type { BuildingOut } from "../../api/voter";

interface VoterBuildingComboboxProps {
  buildings: BuildingOut[];
  value: string;
  onChange: (id: string) => void;
  error?: string;
}

export function VoterBuildingCombobox({
  buildings,
  value,
  onChange,
  error,
}: VoterBuildingComboboxProps) {
  const inputId = useId();
  const listboxId = useId();
  const errorId = useId();

  // Resolve the display name for the current value
  function getNameForId(id: string): string {
    if (!id) return "";
    return buildings.find((b) => b.id === id)?.name ?? "";
  }

  const [inputText, setInputText] = useState(() => getNameForId(value));
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync inputText when value prop changes from outside
  useEffect(() => {
    setInputText(getNameForId(value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Filter buildings by inputText (case-insensitive substring)
  const filtered: Array<{ id: string; name: string }> = [
    { id: "", name: "All buildings" },
    ...buildings.filter((b) =>
      b.name.toLowerCase().includes(inputText.toLowerCase())
    ),
  ];

  function openDropdown() {
    setIsOpen(true);
    setActiveIndex(-1);
  }

  function closeDropdown() {
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function selectOption(id: string, name: string) {
    setInputText(id === "" ? "" : name);
    onChange(id);
    closeDropdown();
    inputRef.current?.focus();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);
    openDropdown();
    // Clear selection when user types
    if (value) {
      onChange("");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        openDropdown();
        return;
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        const opt = filtered[activeIndex];
        selectOption(opt.id, opt.name);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Restore previous text if user cancels
      setInputText(getNameForId(value));
      closeDropdown();
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Restore text to match current value on blur
        setInputText(getNameForId(value));
        closeDropdown();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const activeDescendant =
    activeIndex >= 0 && activeIndex < filtered.length
      ? `${listboxId}-option-${activeIndex}`
      : undefined;

  return (
    <div className="field" ref={containerRef} style={{ position: "relative" }}>
      <label className="field__label" htmlFor={inputId}>
        Select your building
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="field__input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        value={inputText}
        onChange={handleInputChange}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        placeholder="Type to search buildings…"
      />
      {error && (
        <span id={errorId} className="field__error" role="alert">
          {error}
        </span>
      )}
      {isOpen && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Buildings"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 500,
            background: "var(--white)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--shadow-md)",
            maxHeight: 240,
            overflowY: "auto",
            margin: 0,
            padding: 0,
            listStyle: "none",
          }}
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt.id === "" ? "__all__" : opt.id}
              id={`${listboxId}-option-${idx}`}
              role="option"
              aria-selected={opt.id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(opt.id, opt.name);
              }}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                fontSize: "0.9375rem",
                background:
                  idx === activeIndex
                    ? "var(--linen)"
                    : opt.id === value
                    ? "var(--linen-200)"
                    : "transparent",
                fontStyle: opt.id === "" ? "italic" : "normal",
                color: opt.id === "" ? "var(--text-muted)" : "var(--text-primary)",
              }}
            >
              {opt.id === "" ? "All buildings" : opt.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
