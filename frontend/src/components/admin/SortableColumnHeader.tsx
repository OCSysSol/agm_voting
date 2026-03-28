export type SortDir = "asc" | "desc";

export interface SortState {
  column: string;
  dir: SortDir;
}

interface SortableColumnHeaderProps {
  label: string;
  column: string;
  currentSort: SortState | null;
  onSort: (column: string) => void;
}

export default function SortableColumnHeader({
  label,
  column,
  currentSort,
  onSort,
}: SortableColumnHeaderProps) {
  const isActive = currentSort?.column === column;
  const ariaSortValue = isActive
    ? currentSort?.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th aria-sort={ariaSortValue as "ascending" | "descending" | "none"}>
      <button
        type="button"
        className="admin-table__sort-btn"
        onClick={() => onSort(column)}
      >
        {label}
        {isActive ? (
          <span className="sort-indicator sort-indicator--active">
            {currentSort?.dir === "asc" ? "▲" : "▼"}
          </span>
        ) : (
          <span className="sort-indicator">⇅</span>
        )}
      </button>
    </th>
  );
}
