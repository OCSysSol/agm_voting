import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { listBuildings } from "../../api/admin";
import type { Building } from "../../types";

const COMBOBOX_LIMIT = 5;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export interface BuildingSearchComboboxProps {
  value: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
  id?: string;
}

export default function BuildingSearchCombobox({
  value,
  onChange,
  placeholder = "Search buildings",
  id = "building-combobox",
}: BuildingSearchComboboxProps) {
  const [inputText, setInputText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Track whether the display name has been resolved from the value prop
  const [initialised, setInitialised] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedInput = useDebounced(inputText, 300);

  const { data: buildings = [] } = useQuery<Building[]>({
    queryKey: ["admin", "buildings", "combobox", debouncedInput],
    queryFn: () =>
      listBuildings({
        name: debouncedInput || undefined,
        limit: COMBOBOX_LIMIT,
        offset: 0,
        is_archived: false,
        sort_by: "name",
        sort_dir: "asc",
      }),
  });

  // When value is set on mount, resolve the building name to show in the input
  const { data: resolvedBuilding } = useQuery<Building | null>({
    queryKey: ["admin", "buildings", "combobox-resolve", value],
    queryFn: async () => {
      // Fetch enough buildings to find the one matching value
      const all = await listBuildings({ limit: 1000, offset: 0, is_archived: false });
      return all.find((b) => b.id === value) ?? null;
    },
    enabled: !!value && !initialised,
  });

  useEffect(() => {
    if (!initialised) {
      if (value && resolvedBuilding) {
        setInputText(resolvedBuilding.name);
        setInitialised(true);
      } else if (!value) {
        setInitialised(true);
      }
    }
  }, [value, resolvedBuilding, initialised]);

  // Close on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    /* v8 ignore next -- else branch (relatedTarget inside container) is unreachable in practice */
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }, []);

  function selectBuilding(building: Building | null) {
    if (building) {
      setInputText(building.name);
      onChange(building.id, building.name);
    } else {
      setInputText("");
      onChange("", "");
    }
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newText = e.target.value;
    setInputText(newText);
    setIsOpen(true);
    setActiveIndex(-1);
    // Clear selection when user types
    if (value) {
      onChange("", "");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = buildings.length + 1; // +1 for "All buildings" / clear option
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => (prev + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => (prev - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (activeIndex === 0) {
        selectBuilding(null);
      } else if (activeIndex > 0) {
        const selected = buildings[activeIndex - 1];
        /* v8 ignore next -- `selected` is always truthy here: activeIndex is bounded by total = buildings.length + 1 */
        if (selected) selectBuilding(selected);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  const listboxId = `${id}-listbox`;

  /* v8 ignore next -- nullish fallback on id is unreachable: activeIndex is bounded by total = buildings.length + 1 */
  const activeDescendantId =
    isOpen && activeIndex >= 0
      ? activeIndex === 0
        ? `${id}-option-clear`
        : `${id}-option-${buildings[activeIndex - 1]?.id ?? ""}`
      : undefined;

  return (
    <div style={{ position: "relative" }} ref={containerRef} onBlur={handleBlur}>
      <input
        id={id}
        ref={inputRef}
        className="field__input"
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendantId}
        autoComplete="off"
        value={inputText}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        onClick={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Buildings"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--white)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--shadow-md)",
            marginTop: 2,
            padding: 0,
            listStyle: "none",
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          <li
            id={`${id}-option-clear`}
            role="option"
            aria-selected={!value}
            onMouseDown={(e) => { e.preventDefault(); selectBuilding(null); }}
            style={{
              padding: "8px 12px",
              cursor: "pointer",
              fontSize: "0.9rem",
              background: activeIndex === 0 ? "var(--linen-200)" : undefined,
              color: "var(--text-secondary)",
              fontStyle: "italic",
            }}
          >
            All buildings
          </li>
          {buildings.map((b, i) => (
            <li
              key={b.id}
              id={`${id}-option-${b.id}`}
              role="option"
              aria-selected={b.id === value}
              onMouseDown={(e) => { e.preventDefault(); selectBuilding(b); }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: "0.9rem",
                background:
                  b.id === value
                    ? "var(--linen)"
                    : activeIndex === i + 1
                    ? "var(--linen-200)"
                    : undefined,
                fontWeight: b.id === value ? 600 : undefined,
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              {b.name}
            </li>
          ))}
          {buildings.length === 0 && (
            <li
              role="option"
              aria-selected={false}
              style={{
                padding: "8px 12px",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              No buildings found
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
