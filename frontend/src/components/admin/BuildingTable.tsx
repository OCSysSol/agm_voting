import { useNavigate } from "react-router-dom";
import type { Building } from "../../types";

interface BuildingTableProps {
  buildings: Building[];
}

export default function BuildingTable({ buildings }: BuildingTableProps) {
  const navigate = useNavigate();

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Manager Email</th>
          <th>Created At</th>
        </tr>
      </thead>
      <tbody>
        {buildings.map((b) => (
          <tr key={b.id}>
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
              {new Date(b.created_at).toLocaleString()}
            </td>
          </tr>
        ))}
        {buildings.length === 0 && (
          <tr>
            <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px 14px" }}>
              No buildings found.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
