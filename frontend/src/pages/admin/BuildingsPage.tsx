import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listBuildings } from "../../api/admin";
import type { Building } from "../../types";
import BuildingTable from "../../components/admin/BuildingTable";
import BuildingCSVUpload from "../../components/admin/BuildingCSVUpload";
import BuildingForm from "../../components/admin/BuildingForm";

export default function BuildingsPage() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: buildings = [], isLoading, error } = useQuery<Building[]>({
    queryKey: ["admin", "buildings"],
    queryFn: listBuildings,
  });

  function handleSuccess() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "buildings"] });
    setShowCreateForm(false);
  }

  if (isLoading) return <p className="state-message">Loading buildings...</p>;
  if (error) return <p className="state-message state-message--error">Failed to load buildings.</p>;

  return (
    <div>
      <div className="admin-page-header">
        <h1>Buildings</h1>
        {!showCreateForm && (
          <button className="btn btn--primary" onClick={() => setShowCreateForm(true)}>
            + New Building
          </button>
        )}
      </div>
      {showCreateForm && (
        <BuildingForm onSuccess={handleSuccess} onCancel={() => setShowCreateForm(false)} />
      )}
      <div className="admin-card">
        <BuildingTable buildings={buildings} />
      </div>
      <BuildingCSVUpload onSuccess={handleSuccess} />
    </div>
  );
}
