import type { VoteChoice } from "../../types";

interface VoteButtonProps {
  choice: VoteChoice;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

const LABELS: Record<VoteChoice, string> = {
  yes: "For",
  no: "Against",
  abstained: "Abstain",
};

const ICONS: Record<VoteChoice, string> = {
  yes: "✓",
  no: "✗",
  abstained: "—",
};

export function VoteButton({ choice, selected, disabled, onClick }: VoteButtonProps) {
  return (
    <button
      type="button"
      className={`vote-btn vote-btn--${choice}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      <span className="vote-btn__icon" aria-hidden="true">
        {ICONS[choice]}
      </span>
      <span className="vote-btn__label">{LABELS[choice]}</span>
    </button>
  );
}
