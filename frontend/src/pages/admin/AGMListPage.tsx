import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listAGMs } from "../../api/admin";
import type { AGMListItem } from "../../api/admin";
import AGMTable from "../../components/admin/AGMTable";

export default function AGMListPage() {
  const navigate = useNavigate();

  const { data: agms = [], isLoading, error } = useQuery<AGMListItem[]>({
    queryKey: ["admin", "agms"],
    queryFn: listAGMs,
  });

  if (isLoading) return <p className="state-message">Loading AGMs...</p>;
  if (error) return <p className="state-message state-message--error">Failed to load AGMs.</p>;

  return (
    <div>
      <div className="admin-page-header">
        <h1>AGMs</h1>
        <button className="btn btn--primary" onClick={() => navigate("/admin/agms/new")}>
          Create AGM
        </button>
      </div>
      <div className="admin-card">
        <AGMTable agms={agms} />
      </div>
    </div>
  );
}
