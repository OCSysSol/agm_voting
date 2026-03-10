import React from "react";
import type { AGMOut } from "../../api/voter";

function formatLocalDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

interface AGMListItemProps {
  agm: AGMOut;
  onEnterVoting: (agmId: string) => void;
  onViewSubmission: (agmId: string) => void;
}

export function AGMListItem({ agm, onEnterVoting, onViewSubmission }: AGMListItemProps) {
  return (
    <div className="agm-item" data-testid={`agm-item-${agm.id}`}>
      <div className="agm-item__header">
        <h3 className="agm-item__title">{agm.title}</h3>
        <span
          className={`status-badge status-badge--${agm.status}`}
          data-testid="status-badge"
        >
          {agm.status === "open" ? "Open" : "Closed"}
        </span>
      </div>
      <div className="agm-item__meta">
        <span>
          <strong>Meeting:</strong>{" "}
          {formatLocalDateTime(agm.meeting_at)}
        </span>
        <span>
          <strong>Voting closes:</strong>{" "}
          {formatLocalDateTime(agm.voting_closes_at)}
        </span>
      </div>
      {agm.status === "open" ? (
        <button className="btn btn--primary" onClick={() => onEnterVoting(agm.id)}>
          Enter Voting
        </button>
      ) : (
        <button className="btn btn--secondary" onClick={() => onViewSubmission(agm.id)}>
          View My Submission
        </button>
      )}
    </div>
  );
}
