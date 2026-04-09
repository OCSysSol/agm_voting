import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listGeneralMeetings, getGeneralMeetingsCount, listBuildings } from "../../api/admin";
import type { GeneralMeetingListItem } from "../../api/admin";
import type { Building } from "../../types";
import GeneralMeetingTable from "../../components/admin/GeneralMeetingTable";
import type { SortDir } from "../../components/admin/SortableColumnHeader";
import Pagination from "../../components/admin/Pagination";

const PAGE_SIZE = 20;
const COMBOBOX_LIMIT = 5;

// Text columns default to asc, date columns default to desc
const DEFAULT_SORT_DIR: Record<string, SortDir> = {
  title: "asc",
  created_at: "desc",
};

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function GeneralMeetingListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedBuildingId = searchParams.get("building") ?? "";
  const selectedStatus = searchParams.get("status") ?? "";

  // RR2-06: Read page from URL search params; default to 1
  const pageParam = parseInt(searchParams.get("page") ?? "1", 10);
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  // Sort state from URL search params
  const sortBy = searchParams.get("sort_by") ?? "created_at";
  const sortDir = (searchParams.get("sort_dir") ?? "desc") as SortDir;

  // --- Building combobox state ---
  const [comboInput, setComboInput] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Track whether the combobox has been initialised from the URL param
  const [comboInitialised, setComboInitialised] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedComboInput = useDebounced(comboInput, 300);

  const { data: comboBuildings = [] } = useQuery<Building[]>({
    queryKey: ["admin", "buildings", "combobox", debouncedComboInput],
    queryFn: () =>
      listBuildings({
        name: debouncedComboInput || undefined,
        limit: COMBOBOX_LIMIT,
        offset: 0,
        is_archived: false,
      }),
  });

  // On mount: if there's a selectedBuildingId in the URL, look up the building name
  // so the combobox input shows the selected building's name.
  const { data: selectedBuilding } = useQuery<Building | null>({
    queryKey: ["admin", "buildings", "combobox-selected", selectedBuildingId],
    // This query only runs when selectedBuildingId is truthy (see enabled below),
    // so there is no need to guard against empty selectedBuildingId here.
    // Fetch all to resolve the name for any building ID in the URL.
    queryFn: async () => {
      const all = await listBuildings({ limit: 1000, offset: 0, is_archived: false });
      return all.find((b) => b.id === selectedBuildingId) ?? null;
    },
    enabled: !!selectedBuildingId && !comboInitialised,
  });

  // Once we have the selected building name, populate the input field
  useEffect(() => {
    if (selectedBuilding && !comboInitialised) {
      setComboInput(selectedBuilding.name);
      setComboInitialised(true);
    } else if (!selectedBuildingId && !comboInitialised) {
      setComboInitialised(true);
    }
  }, [selectedBuilding, selectedBuildingId, comboInitialised]);

  // Close combobox when clicking outside
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  function selectBuilding(building: Building | null) {
    const next = new URLSearchParams(searchParams);
    if (building) {
      next.set("building", building.id);
      setComboInput(building.name);
    } else {
      next.delete("building");
      setComboInput("");
    }
    next.delete("page");
    setSearchParams(next);
    setComboOpen(false);
    setActiveIndex(-1);
  }

  function handleComboInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setComboInput(e.target.value);
    setComboOpen(true);
    setActiveIndex(-1);
    // Clear URL building param when user starts typing
    if (selectedBuildingId) {
      const next = new URLSearchParams(searchParams);
      next.delete("building");
      next.delete("page");
      setSearchParams(next);
    }
  }

  function handleComboKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const options = comboBuildings;
    const total = options.length + 1; // +1 for "All buildings"
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setComboOpen(true);
      setActiveIndex((prev) => (prev + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setComboOpen(true);
      setActiveIndex((prev) => (prev - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!comboOpen) {
        setComboOpen(true);
        return;
      }
      if (activeIndex === 0) {
        selectBuilding(null);
      } else if (activeIndex > 0) {
        const selected = options[activeIndex - 1];
        /* v8 ignore next -- `selected` is always truthy here: activeIndex is bounded by total = options.length + 1 */
        if (selected) selectBuilding(selected);
      }
    } else if (e.key === "Escape") {
      setComboOpen(false);
      setActiveIndex(-1);
    }
  }

  const listboxId = "building-combobox-listbox";

  // Compute active descendant id
  /* v8 ignore next -- nullish fallback on id is unreachable: activeIndex is bounded by total = comboBuildings.length + 1 */
  const activeDescendantId =
    comboOpen && activeIndex >= 0
      ? activeIndex === 0
        ? "building-option-all"
        : `building-option-${comboBuildings[activeIndex - 1]?.id ?? ""}`
      : undefined;

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["admin", "general-meetings", "count", selectedBuildingId, selectedStatus],
    queryFn: () =>
      getGeneralMeetingsCount({
        building_id: selectedBuildingId || undefined,
        status: selectedStatus || undefined,
      }),
  });

  const totalCount = countData?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const { data: meetings = [], isLoading, error } = useQuery<GeneralMeetingListItem[]>({
    queryKey: ["admin", "general-meetings", "list", safePage, selectedBuildingId, selectedStatus, sortBy, sortDir],
    queryFn: () =>
      listGeneralMeetings({
        limit: PAGE_SIZE,
        offset: (safePage - 1) * PAGE_SIZE,
        building_id: selectedBuildingId || undefined,
        status: selectedStatus || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
      }),
  });

  // Prefetch next page
  useEffect(() => {
    const nextOffset = safePage * PAGE_SIZE;
    if (nextOffset < totalCount) {
      void queryClient.prefetchQuery({
        queryKey: ["admin", "general-meetings", "list", safePage + 1, selectedBuildingId, selectedStatus, sortBy, sortDir],
        queryFn: () =>
          listGeneralMeetings({
            limit: PAGE_SIZE,
            offset: nextOffset,
            building_id: selectedBuildingId || undefined,
            status: selectedStatus || undefined,
            sort_by: sortBy,
            sort_dir: sortDir,
          }),
      });
    }
  }, [safePage, selectedBuildingId, selectedStatus, totalCount, queryClient, sortBy, sortDir]);

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set("status", value);
    } else {
      next.delete("status");
    }
    // Reset page to 1 when filter changes
    next.delete("page");
    setSearchParams(next);
  }

  // RR2-06: Update URL search param on page change (use replace to avoid polluting history)
  function handlePageChange(newPage: number) {
    const next = new URLSearchParams(searchParams);
    if (newPage === 1) {
      next.delete("page");
    } else {
      next.set("page", String(newPage));
    }
    setSearchParams(next, { replace: true });
  }

  function handleSortChange(column: string) {
    const next = new URLSearchParams(searchParams);
    // Reset page to 1 on sort change
    next.delete("page");
    if (column === sortBy) {
      // Toggle direction
      const newDir: SortDir = sortDir === "asc" ? "desc" : "asc";
      next.set("sort_by", column);
      next.set("sort_dir", newDir);
    } else {
      // New column — use its default direction (all valid columns are in DEFAULT_SORT_DIR)
      /* v8 ignore next -- "asc" fallback is unreachable: all valid sort columns are in DEFAULT_SORT_DIR */
      const newDir: SortDir = DEFAULT_SORT_DIR[column] !== undefined ? DEFAULT_SORT_DIR[column] : "asc";
      next.set("sort_by", column);
      next.set("sort_dir", newDir);
    }
    setSearchParams(next, { replace: true });
  }

  // Stable callback for closing combobox when focus leaves the container
  const handleComboBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    /* v8 ignore next -- else branch (relatedTarget inside container) is unreachable in practice */
    if (!comboRef.current?.contains(e.relatedTarget as Node)) {
      setComboOpen(false);
      setActiveIndex(-1);
    }
  }, []);

  if (error) return <p className="state-message state-message--error">Failed to load General Meetings.</p>;

  return (
    <div>
      <div className="admin-page-header">
        <h1>General Meetings</h1>
        <button className="btn btn--primary" onClick={() => navigate("/admin/general-meetings/new")}>
          Create General Meeting
        </button>
      </div>
      <div className="admin-card">
        <div className="admin-card__header">
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
            {/* Building search combobox */}
            <div style={{ maxWidth: 280, position: "relative" }} ref={comboRef} onBlur={handleComboBlur}>
              <label className="field__label" htmlFor="building-combobox">Building</label>
              <input
                id="building-combobox"
                ref={inputRef}
                className="field__input"
                type="text"
                role="combobox"
                aria-expanded={comboOpen}
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={activeDescendantId}
                autoComplete="off"
                value={comboInput}
                onChange={handleComboInputChange}
                onFocus={() => setComboOpen(true)}
                onClick={() => setComboOpen(true)}
                onKeyDown={handleComboKeyDown}
                placeholder="All buildings"
              />
              {comboOpen && (
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
                    id="building-option-all"
                    role="option"
                    aria-selected={!selectedBuildingId}
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
                  {comboBuildings.map((b, i) => (
                    <li
                      key={b.id}
                      id={`building-option-${b.id}`}
                      role="option"
                      aria-selected={b.id === selectedBuildingId}
                      onMouseDown={(e) => { e.preventDefault(); selectBuilding(b); }}
                      style={{
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                        background:
                          b.id === selectedBuildingId
                            ? "var(--linen)"
                            : activeIndex === i + 1
                            ? "var(--linen-200)"
                            : undefined,
                        fontWeight: b.id === selectedBuildingId ? 600 : undefined,
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      {b.name}
                    </li>
                  ))}
                  {comboBuildings.length === 0 && (
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

            <div style={{ maxWidth: 180 }}>
              <label className="field__label" htmlFor="status-filter">Status</label>
              <select
                id="status-filter"
                className="field__select"
                value={selectedStatus}
                onChange={handleStatusChange}
              >
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
        </div>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          isLoading={isLoading}
        />
        {/* RR2-07: Show loading overlay while fetching page change */}
        <div style={{ opacity: isLoading ? 0.5 : 1, transition: "opacity 0.15s", pointerEvents: isLoading ? "none" : "auto" }}>
          <GeneralMeetingTable
            meetings={meetings}
            isLoading={isLoading}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSortChange}
          />
        </div>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
