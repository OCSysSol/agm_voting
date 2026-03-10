import type { SaveStatus } from "../../hooks/useAutoSave";

interface SaveIndicatorProps {
  status: SaveStatus;
  onSave: () => void;
}

export function SaveIndicator({ status, onSave }: SaveIndicatorProps) {
  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <span aria-live="polite" className="save-indicator save-indicator--saving">
        Saving...
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span aria-live="polite" className="save-indicator save-indicator--saved">
        ✓ Saved
      </span>
    );
  }

  // error
  return (
    <span aria-live="assertive" className="save-indicator save-indicator--error">
      Could not save.{" "}
      <button type="button" className="btn--ghost" onClick={onSave} style={{ padding: "0 4px", fontSize: "0.775rem" }}>
        Retry
      </button>
    </span>
  );
}
