import { useEffect, useRef } from "react";

interface SubmitDialogProps {
  unansweredMotions: { display_order: number; motion_number: string | null; title: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SubmitDialog({ unansweredMotions, onConfirm, onCancel }: SubmitDialogProps) {
  const hasUnanswered = unansweredMotions.length > 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Save current focus so we can restore it when dialog closes
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Move focus to first focusable element in dialog
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    if (focusable && focusable.length > 0) {
      focusable[0].focus();
    }

    return () => {
      // Restore focus when dialog unmounts
      previousFocusRef.current?.focus();
    };
  }, []);

  // US-ACC-02: Trap Tab/Shift+Tab focus within the dialog; Escape closes it
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-dialog-title"
      className="dialog-overlay"
      ref={dialogRef}
      onKeyDown={handleKeyDown}
    >
      <div className="dialog">
        <div className={`dialog__icon dialog__icon--${hasUnanswered ? "warning" : "confirm"}`}>
          {hasUnanswered ? "⚠" : "✓"}
        </div>
        <h2 className="dialog__title" id="submit-dialog-title">
          {hasUnanswered ? "Unanswered motions" : "Confirm submission"}
        </h2>
        {hasUnanswered ? (
          <>
            <p className="dialog__body">
              {unansweredMotions.length} motion{unansweredMotions.length !== 1 ? "s" : ""} are unanswered and will be recorded as <strong>Abstained</strong>.
            </p>
            <ul className="dialog__list">
              {unansweredMotions.map((m) => (
                <li className="dialog__list-item" key={m.display_order}>
                  Motion {m.motion_number?.trim() || m.display_order} — {m.title}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="dialog__body">
            Are you sure? Votes cannot be changed after submission.
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={onConfirm}>
            Submit ballot
          </button>
        </div>
      </div>
    </div>
  );
}
