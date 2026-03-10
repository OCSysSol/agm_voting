interface ProgressBarProps {
  answered: number;
  total: number;
}

export function ProgressBar({ answered, total }: ProgressBarProps) {
  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <div className="progress-bar" aria-label={`${answered} / ${total} motions answered`}>
      <div className="progress-bar__header">
        <span className="progress-bar__text">Motions answered</span>
        <span className="progress-bar__count">{answered} / {total}</span>
      </div>
      <div
        className="progress-bar__track"
        role="progressbar"
        aria-valuenow={answered}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className="progress-bar__fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
