import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Building } from "../../types";
import Pagination from "./Pagination";
import SortableColumnHeader from "./SortableColumnHeader";
import type { SortDir } from "./SortableColumnHeader";
import { formatLocalDateTime } from "../../utils/dateTime";

const PAGE_SIZE = 20;

interface BuildingTableProps {
  buildings: Building[];
  isLoading?: boolean;
  sortBy?: string;
  sortDir?: SortDir;
  onSort?: (col: string) => void;
}

export default function BuildingTable({ buildings, isLoading, sortBy, sortDir, onSort }: BuildingTableProps) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const currentSort = sortBy && sortDir ? { column: sortBy, dir: sortDir } : null;

  const totalPages = Math.max(1, Math.ceil(buildings.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = buildings.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const paginationControls = totalPages > 1 ? (
    <Pagination
      page={safePage}
      totalPages={totalPages}
      totalItems={buildings.length}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
    />
  ) : null;

  return (
    <div>
      {paginationControls}
      <div className="admin-table-wrapper">
      <table className="admin-table">
        <thead>
          <tr>
            {onSort ? (
              <SortableColumnHeader
                label="Name"
                column="name"
                currentSort={currentSort}
                onSort={onSort}
              />
            ) : (
              <th>Name</th>
            )}
            {onSort ? (
              <SortableColumnHeader
                label="Manager Email"
                column="manager_email"
                currentSort={currentSort}
                onSort={onSort}
              />
            ) : (
              <th>Manager Email</th>
            )}
            {onSort ? (
              <SortableColumnHeader
                label="Created At"
                column="created_at"
                currentSort={currentSort}
                onSort={onSort}
              />
            ) : (
              <th>Created At</th>
            )}
          </tr>
        </thead>
        <tbody>
          {isLoading && !buildings.length ? (
            <tr>
              <td colSpan={3} className="state-message">Loading buildings...</td>
            </tr>
          ) : buildings.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px 14px" }}>
                No buildings found.
              </td>
            </tr>
          ) : (
            visible.map((b) => (
              <tr key={b.id} style={b.is_archived ? { opacity: 0.6 } : undefined}>
                <td>
                  <button
                    className="admin-table__link"
                    onClick={() => navigate(`/admin/buildings/${b.id}`)}
                  >
                    {b.name}
                  </button>
                </td>
                <td>{b.manager_email}</td>
                <td style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                  {formatLocalDateTime(b.created_at)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      {paginationControls}
    </div>
  );
}
