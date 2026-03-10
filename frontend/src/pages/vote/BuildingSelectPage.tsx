import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchBuildings, fetchAGMs } from "../../api/voter";
import { BuildingDropdown } from "../../components/vote/BuildingDropdown";
import { AGMList } from "../../components/vote/AGMList";

export function BuildingSelectPage() {
  const navigate = useNavigate();
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [buildingError, setBuildingError] = useState("");

  const { data: buildings, isLoading: buildingsLoading, isError: buildingsError } = useQuery({
    queryKey: ["buildings"],
    queryFn: fetchBuildings,
  });

  const { data: agms, isLoading: agmsLoading } = useQuery({
    queryKey: ["agms", selectedBuildingId],
    queryFn: () => fetchAGMs(selectedBuildingId),
    enabled: !!selectedBuildingId,
  });

  const handleBuildingChange = (id: string) => {
    setSelectedBuildingId(id);
    setBuildingError("");
  };

  const handleEnterVoting = (agmId: string) => {
    navigate(`/vote/${agmId}/auth`);
  };

  const handleViewSubmission = (agmId: string) => {
    navigate(`/vote/${agmId}/auth?view=submission`);
  };

  if (buildingsLoading) {
    return (
      <main className="voter-content">
        <p className="state-message">Loading buildings...</p>
      </main>
    );
  }

  if (buildingsError) {
    return (
      <main className="voter-content">
        <p className="state-message state-message--error" role="alert">
          Failed to load buildings. Please try again.
        </p>
      </main>
    );
  }

  return (
    <main className="voter-content">
      <div className="hero">
        <span className="hero__badge">Annual General Meeting</span>
        <h1 className="hero__title">Cast Your Vote</h1>
        <p className="hero__subtitle">
          Select your building to find and vote on open AGM motions.
        </p>
      </div>

      <div style={{ textAlign: "right", marginBottom: "12px" }}>
        <Link to="/admin/buildings" className="btn btn--admin">
          Admin portal →
        </Link>
      </div>

      <div className="card">
        <BuildingDropdown
          /* c8 ignore next */
          buildings={buildings ?? []}
          value={selectedBuildingId}
          onChange={handleBuildingChange}
          error={buildingError}
        />
        {agmsLoading && (
          <p className="state-message" style={{ padding: "24px 0 8px" }}>
            Loading AGMs...
          </p>
        )}
        {agms && (
          <AGMList
            agms={agms}
            onEnterVoting={handleEnterVoting}
            onViewSubmission={handleViewSubmission}
          />
        )}
      </div>
    </main>
  );
}
