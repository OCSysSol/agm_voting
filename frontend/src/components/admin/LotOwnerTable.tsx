import type { LotOwner } from "../../types";

interface LotOwnerTableProps {
  lotOwners: LotOwner[];
  onEdit: (lotOwner: LotOwner) => void;
}

export default function LotOwnerTable({ lotOwners, onEdit }: LotOwnerTableProps) {
  return (
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
        {lotOwners.map((lo) => (
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
  );
}
