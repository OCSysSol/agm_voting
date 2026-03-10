import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listBuildings, listLotOwners } from "../../api/admin";
import type { Building, LotOwner } from "../../types";
import LotOwnerTable from "../../components/admin/LotOwnerTable";
import LotOwnerForm from "../../components/admin/LotOwnerForm";
import LotOwnerCSVUpload from "../../components/admin/LotOwnerCSVUpload";

export default function BuildingDetailPage() {
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editTarget, setEditTarget] = useState<LotOwner | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: buildings = [] } = useQuery<Building[]>({
    queryKey: ["admin", "buildings"],
    queryFn: listBuildings,
  });

  const building = buildings.find((b) => b.id === buildingId);

  const {
    data: lotOwners = [],
    isLoading,
    error,
  } = useQuery<LotOwner[]>({
    queryKey: ["admin", "lot-owners", buildingId],
    queryFn: () => listLotOwners(buildingId!),
    enabled: !!buildingId,
  });

  function handleEdit(lo: LotOwner) {
    setEditTarget(lo);
    setShowForm(true);
  }

  function handleAddNew() {
    setEditTarget(null);
    setShowForm(true);
  }

  function handleFormSuccess() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "lot-owners", buildingId] });
    setShowForm(false);
    setEditTarget(null);
  }

  function handleFormCancel() {
    setShowForm(false);
    setEditTarget(null);
  }

  function handleCSVSuccess() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "lot-owners", buildingId] });
  }

  if (isLoading) return <p className="state-message">Loading lot owners...</p>;
  if (error) return <p className="state-message state-message--error">Failed to load lot owners.</p>;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 style={{ marginBottom: 2 }}>{building ? building.name : "Building"}</h1>
          {building && (
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {building.manager_email}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--secondary" onClick={handleAddNew}>Add Lot Owner</button>
          <button className="btn btn--primary" onClick={() => navigate("/admin/agms/new")}>Create AGM</button>
        </div>
      </div>

      {showForm && (
        <LotOwnerForm
          buildingId={buildingId!}
          editTarget={editTarget}
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
        />
      )}

      <div className="admin-card">
        <LotOwnerTable lotOwners={lotOwners} onEdit={handleEdit} />
      </div>

      <LotOwnerCSVUpload
        buildingId={buildingId!}
        onSuccess={handleCSVSuccess}
      />
    </div>
  );
}
