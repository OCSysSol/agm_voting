import { useState } from "react";
import type { LotOwner } from "../../types";
import Pagination from "./Pagination";

const PAGE_SIZE = 25;

interface LotOwnerTableProps {
  lotOwners: LotOwner[];
  onEdit: (lotOwner: LotOwner) => void;
}

export default function LotOwnerTable({ lotOwners, onEdit }: LotOwnerTableProps) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(lotOwners.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = lotOwners.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Lot Number</th>
            <th>Email</th>
            <th>Unit Entitlement</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((lo) => (
            <tr key={lo.id}>
              <td style={{ fontFamily: "'Overpass Mono', monospace", fontSize: "0.875rem" }}>
                {lo.lot_number}
              </td>
              <td>{lo.email}</td>
              <td style={{ fontFamily: "'Overpass Mono', monospace", fontSize: "0.875rem" }}>
                {lo.unit_entitlement}
              </td>
              <td>
                <button className="btn btn--secondary" style={{ padding: "5px 14px", fontSize: "0.8rem" }} onClick={() => onEdit(lo)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
          {lotOwners.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px 14px" }}>
                No lot owners found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={lotOwners.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}
