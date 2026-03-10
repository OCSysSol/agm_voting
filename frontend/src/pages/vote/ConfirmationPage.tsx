import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMyBallot } from "../../api/voter";

const CHOICE_LABELS: Record<string, string> = {
  yes: "For",
  no: "Against",
  abstained: "Abstained",
};

export function ConfirmationPage() {
  const { agmId } = useParams<{ agmId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["my-ballot", agmId],
    queryFn: () => fetchMyBallot(agmId!),
    enabled: !!agmId,
    retry: false,
  });

  if (isLoading) {
    return (
      <main className="voter-content">
        <p className="state-message">Loading your submission...</p>
      </main>
    );
  }

  if (isError) {
    const err = error as Error;
    if (err.message.includes("404")) {
      return (
        <main className="voter-content">
          <p className="state-message">You did not submit a ballot for this meeting.</p>
        </main>
      );
    }
    return (
      <main className="voter-content">
        <p className="state-message state-message--error" role="alert">
          Failed to load your ballot. Please try again.
        </p>
      </main>
    );
  }

  /* c8 ignore next 3 */
  if (!data) {
    return null;
  }

  const sortedVotes = [...data.votes].sort((a, b) => a.order_index - b.order_index);

  return (
    <main className="voter-content">
      <div className="card">
        <div className="confirmation">
          <div className="confirmation__check" aria-hidden="true">✓</div>
          <h1 className="confirmation__title">Ballot submitted</h1>
          <p className="confirmation__subtitle">
            Your votes have been recorded. Thank you for participating.
          </p>
        </div>

        <div className="vote-meta">
          <div className="vote-meta__row">
            <span className="vote-meta__label">Building</span>
            <span className="vote-meta__value">{data.building_name}</span>
          </div>
          <div className="vote-meta__row">
            <span className="vote-meta__label">Meeting</span>
            <span className="vote-meta__value">{data.agm_title}</span>
          </div>
          <div className="vote-meta__row">
            <span className="vote-meta__label">Voter</span>
            <span className="vote-meta__value">{data.voter_email}</span>
          </div>
        </div>

        <div className="vote-summary">
          <p className="vote-summary__heading">Your votes</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sortedVotes.map((v) => (
              <li className="vote-item" key={v.motion_id}>
                <span className="vote-item__motion">{v.motion_title}</span>
                <span className={`vote-item__choice vote-item__choice--${v.choice}`}>
                  {CHOICE_LABELS[v.choice] ?? v.choice}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="submit-section" style={{ borderTop: "none", marginTop: "24px", paddingTop: "0" }}>
          <button className="btn btn--ghost" onClick={() => navigate("/")}>
            ← Back to home
          </button>
        </div>
      </div>
    </main>
  );
}
