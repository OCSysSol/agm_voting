/**
 * SubmitSection — extracted from VotingPage (US-CQM-03).
 *
 * Renders the submit ballot button or "all voted" state at the bottom of the
 * voting form. Fully controlled: all state and callbacks live in VotingPage.
 *
 * RR3-39: submit button uses aria-disabled when disabled so screen readers
 * announce the state even when the button is visually greyed out.
 */

interface SubmitSectionProps {
  unvotedCount: number;
  isClosed: boolean;
  showSidebar: boolean;
  isPending: boolean;
  /** Fix 6: show "View Submission" as soon as any lot has been submitted */
  anySubmitted: boolean;
  onSubmitClick: () => void;
  onViewSubmission: () => void;
}

export function SubmitSection({
  unvotedCount,
  isClosed,
  showSidebar,
  isPending,
  anySubmitted,
  onSubmitClick,
  onViewSubmission,
}: SubmitSectionProps) {
  if (isClosed) return null;

  if (unvotedCount === 0 && !showSidebar) {
    return (
      <div className="submit-section">
        <p className="state-message" data-testid="all-voted-message">
          You have voted on all motions.
        </p>
        <button type="button" className="btn btn--primary" onClick={onViewSubmission}>
          View Submission
        </button>
      </div>
    );
  }

  if (unvotedCount > 0) {
    return (
      <div className="submit-section">
        {/* RR3-39: aria-disabled announces disabled state to screen readers even when
            the button is not HTML-disabled (i.e. still accepts keyboard focus). */}
        <button
          type="button"
          className="btn btn--primary"
          onClick={onSubmitClick}
          disabled={isPending}
          aria-disabled={isPending ? "true" : undefined}
        >
          {isPending ? "Submitting…" : "Submit ballot"}
        </button>
        {anySubmitted && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onViewSubmission}
          >
            View Submission
          </button>
        )}
      </div>
    );
  }

  return null;
}
