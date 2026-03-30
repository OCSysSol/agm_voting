import type { MotionType } from "../../types";

export interface MotionFormEntry {
  title: string;
  description: string;
  motion_number: string | null;
  motion_type: MotionType;
  is_multi_choice?: boolean;
  option_limit?: string;
  options?: Array<{ text: string }>;
}

interface MotionEditorProps {
  motions: MotionFormEntry[];
  onChange: (motions: MotionFormEntry[]) => void;
}

export default function MotionEditor({ motions, onChange }: MotionEditorProps) {
  function addMotion() {
    onChange([...motions, { title: "", description: "", motion_number: "", motion_type: "general", is_multi_choice: false, option_limit: "1", options: [{ text: "" }, { text: "" }] }]);
  }

  function removeMotion(index: number) {
    onChange(motions.filter((_, i) => i !== index));
  }

  function updateMotion(index: number, field: keyof MotionFormEntry, value: string) {
    onChange(motions.map((m, i) => i === index ? { ...m, [field]: value } : m));
  }

  function updateIsMultiChoice(index: number, checked: boolean) {
    onChange(motions.map((m, i) => i === index ? { ...m, is_multi_choice: checked } : m));
  }

  function updateOption(motionIndex: number, optionIndex: number, text: string) {
    const updated = motions.map((m, i) => {
      if (i !== motionIndex) return m;
      const opts = [...(m.options ?? [{ text: "" }, { text: "" }])];
      opts[optionIndex] = { text };
      return { ...m, options: opts };
    });
    onChange(updated);
  }

  function addOption(motionIndex: number) {
    const updated = motions.map((m, i) => {
      if (i !== motionIndex) return m;
      return { ...m, options: [...(m.options ?? []), { text: "" }] };
    });
    onChange(updated);
  }

  function removeOption(motionIndex: number, optionIndex: number) {
    const updated = motions.map((m, i) => {
      if (i !== motionIndex) return m;
      const opts = (m.options ?? []).filter((_, oi) => oi !== optionIndex);
      return { ...m, options: opts };
    });
    onChange(updated);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <p className="section-label" style={{ marginBottom: 12 }}>Motions</p>
      {motions.map((motion, index) => (
        <div key={index} className="motion-entry">
          <div className="motion-entry__header">Motion {index + 1}</div>
          <div className="field">
            <label className="field__label" htmlFor={`motion-title-${index}`}>Title</label>
            <input
              id={`motion-title-${index}`}
              className="field__input"
              type="text"
              value={motion.title}
              onChange={(e) => updateMotion(index, "title", e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label className="field__label" htmlFor={`motion-number-${index}`}>Motion number (optional)</label>
            <input
              id={`motion-number-${index}`}
              className="field__input"
              type="text"
              value={motion.motion_number ?? ""}
              onChange={(e) => updateMotion(index, "motion_number", e.target.value)}
              placeholder="e.g. 1, SR-1"
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label className="field__label" htmlFor={`motion-desc-${index}`}>Description</label>
            <textarea
              id={`motion-desc-${index}`}
              className="field__input"
              value={motion.description}
              onChange={(e) => updateMotion(index, "description", e.target.value)}
              rows={3}
              style={{ resize: "vertical" }}
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label className="field__label" htmlFor={`motion-type-${index}`}>Motion Type</label>
            <select
              id={`motion-type-${index}`}
              className="field__select"
              value={motion.motion_type}
              onChange={(e) => updateMotion(index, "motion_type", e.target.value)}
            >
              <option value="general">General</option>
              <option value="special">Special</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label className="field__label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id={`motion-is-multi-choice-${index}`}
                type="checkbox"
                checked={motion.is_multi_choice ?? false}
                onChange={(e) => updateIsMultiChoice(index, e.target.checked)}
              />
              Multi-choice question format
            </label>
          </div>
          {motion.is_multi_choice && (
            <>
              <div className="field" style={{ marginBottom: 8 }}>
                <label className="field__label" htmlFor={`motion-option-limit-${index}`}>Max selections per voter</label>
                <input
                  id={`motion-option-limit-${index}`}
                  className="field__input"
                  type="number"
                  min={1}
                  value={motion.option_limit ?? "1"}
                  onChange={(e) => updateMotion(index, "option_limit", e.target.value)}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <p className="field__label" style={{ marginBottom: 6 }}>Options (min 2)</p>
                {(motion.options ?? [{ text: "" }, { text: "" }]).map((opt, oi) => (
                  <div key={oi} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input
                      aria-label={`Motion ${index + 1} option ${oi + 1}`}
                      className="field__input"
                      type="text"
                      value={opt.text}
                      onChange={(e) => updateOption(index, oi, e.target.value)}
                      placeholder={`Option ${oi + 1}`}
                    />
                    {(motion.options ?? []).length > 2 && (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        aria-label={`Remove motion ${index + 1} option ${oi + 1}`}
                        onClick={() => removeOption(index, oi)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => addOption(index)}
                >
                  + Add option
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            className="btn btn--danger"
            style={{ fontSize: "0.75rem", padding: "5px 12px", textTransform: "none", letterSpacing: 0 }}
            onClick={() => removeMotion(index)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--secondary" style={{ marginTop: 4 }} onClick={addMotion}>
        + Add Motion
      </button>
    </div>
  );
}
