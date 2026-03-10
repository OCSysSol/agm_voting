import { useNavigate } from "react-router-dom";
import type { AGMListItem } from "../../api/admin";
import StatusBadge from "./StatusBadge";

interface AGMTableProps {
  agms: AGMListItem[];
}

export default function AGMTable({ agms }: AGMTableProps) {
  const navigate = useNavigate();

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Building</th>
          <th>Title</th>
          <th>Status</th>
          <th>Meeting At</th>
          <th>Voting Closes At</th>
        </tr>
      </thead>
      <tbody>
        {agms.map((agm) => (
          <tr
            key={agm.id}
            style={{ cursor: "pointer" }}
            onClick={() => navigate(`/admin/agms/${agm.id}`)}
          >
            <td style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>{agm.building_name}</td>
            <td style={{ fontWeight: 600 }}>{agm.title}</td>
            <td><StatusBadge status={agm.status} /></td>
            <td style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
              {new Date(agm.meeting_at).toLocaleString()}
            </td>
            <td style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
              {new Date(agm.voting_closes_at).toLocaleString()}
            </td>
          </tr>
        ))}
        {agms.length === 0 && (
          <tr>
            <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px 14px" }}>
              No AGMs found.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
