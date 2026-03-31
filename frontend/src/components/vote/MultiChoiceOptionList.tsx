import type { MotionOut } from "../../api/voter";

interface MultiChoiceOptionListProps {
  motion: MotionOut;
  selectedOptionIds: string[];
  onSelectionChange: (motionId: string, optionIds: string[]) => void;
  disabled: boolean;
  readOnly?: boolean;
}

export function MultiChoiceOptionList({
  motion,
  selectedOptionIds,
  onSelectionChange,
  disabled,
  readOnly = false,
}: MultiChoiceOptionListProps) {
  const optionLimit = motion.option_limit ?? motion.options.length;
  const selectedCount = selectedOptionIds.length;
  const limitReached = selectedCount >= optionLimit;

  function handleChange(optionId: string, checked: boolean) {
    if (disabled || readOnly) return;
    if (checked) {
      if (!limitReached) {
        onSelectionChange(motion.id, [...selectedOptionIds, optionId]);
      }
    } else {
      onSelectionChange(motion.id, selectedOptionIds.filter((id) => id !== optionId));
    }
  }

  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
      {/* RR3-24: legend associates the group of checkboxes with the motion question for screen readers */}
      <legend className="motion-card__title" style={{ float: "left", width: "100%", marginBottom: 8 }}>
        {motion.title}
      </legend>
      <p className="multi-choice-counter" data-testid="mc-counter">
        {`Select up to ${optionLimit} option${optionLimit !== 1 ? "s" : ""} — ${selectedCount} selected`}
      </p>
      {motion.options.map((option) => {
        const isChecked = selectedOptionIds.includes(option.id);
        const isDisabledByLimit = !isChecked && limitReached;
        const isEffectivelyDisabled = disabled || readOnly || isDisabledByLimit;

        return (
          <label
            key={option.id}
            className={`multi-choice-option${isDisabledByLimit ? " multi-choice-option--disabled" : ""}`}
          >
            <input
              type="checkbox"
              aria-label={option.text}
              checked={isChecked}
              disabled={isEffectivelyDisabled}
              onChange={(e) => handleChange(option.id, e.target.checked)}
            />
            <span className="multi-choice-option__text">{option.text}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
