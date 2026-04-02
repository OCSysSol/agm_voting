import type { VoteChoice } from "../../types";
import type { MotionOut } from "../../api/voter";
import { VoteButton } from "./VoteButton";
import { MultiChoiceOptionList } from "./MultiChoiceOptionList";

const CHOICES: VoteChoice[] = ["yes", "no", "abstained"];

const MOTION_TYPE_LABELS: Record<string, string> = {
  general: "General",
  special: "Special",
};

type OptionChoiceMap = Record<string, "for" | "against" | "abstained">;

interface MotionCardProps {
  motion: MotionOut;
  position: number;
  choice: VoteChoice | null;
  onChoiceChange: (motionId: string, choice: VoteChoice | null) => void;
  disabled: boolean;
  highlight: boolean;
  readOnly?: boolean;
  // Multi-choice state (only used for multi_choice motion type)
  multiChoiceOptionChoices?: OptionChoiceMap;
  onMultiChoiceChange?: (motionId: string, choices: OptionChoiceMap) => void;
}

export function MotionCard({
  motion,
  position,
  choice,
  onChoiceChange,
  disabled,
  highlight,
  readOnly = false,
  multiChoiceOptionChoices = {},
  onMultiChoiceChange,
}: MotionCardProps) {
  const handleClick = (c: VoteChoice) => {
    /* c8 ignore next */
    if (disabled || readOnly) return;
    // Clicking the currently selected choice deselects it
    const next = choice === c ? null : c;
    onChoiceChange(motion.id, next);
  };

  const isMultiChoice = motion.is_multi_choice;
  const isSpecial = motion.motion_type === "special";
  const isEffectivelyDisabled = disabled || readOnly;

  const badgeClass = isSpecial
    ? "motion-type-badge--special"
    : isMultiChoice
    ? "motion-type-badge--multi_choice"
    : "motion-type-badge--general";
  const typeLabel = isMultiChoice
    ? "Multi-Choice"
    : MOTION_TYPE_LABELS[motion.motion_type] ?? motion.motion_type;

  return (
    <div
      data-testid={`motion-card-${motion.id}`}
      className={`motion-card${highlight ? " motion-card--highlight" : ""}${readOnly ? " motion-card--read-only" : ""}`}
    >
      <div className="motion-card__top-row">
        <p className="motion-card__number">{`Motion ${motion.motion_number?.trim() || position}`}</p>
        <span
          className={`motion-type-badge ${badgeClass}`}
          aria-label={`Motion type: ${typeLabel}`}
        >
          {typeLabel}
        </span>
        {highlight && (
          <span className="motion-card__unanswered-badge" aria-label="Unanswered">
            ! Unanswered
          </span>
        )}
        {readOnly && (
          <span className="motion-card__voted-badge" aria-label="Already voted">
            ✓ Already voted
          </span>
        )}
      </div>
      <h3 className="motion-card__title">{motion.title}</h3>
      {motion.description && (
        <p className="motion-card__description">{motion.description}</p>
      )}
      {isMultiChoice ? (
        <MultiChoiceOptionList
          motion={motion}
          optionChoices={multiChoiceOptionChoices}
          onChoiceChange={onMultiChoiceChange ?? (() => {})}
          disabled={isEffectivelyDisabled}
          readOnly={readOnly}
        />
      ) : (
        <div className="vote-buttons">
          {CHOICES.map((c) => (
            <VoteButton
              key={c}
              choice={c}
              selected={choice === c}
              disabled={isEffectivelyDisabled}
              ariaDisabled={false}
              onClick={() => handleClick(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
