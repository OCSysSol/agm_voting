import { useCountdown } from "../../hooks/useCountdown";
import type { UseServerTimeResult } from "../../hooks/useServerTime";

interface CountdownTimerProps {
  closesAt: string;
  serverTime: UseServerTimeResult;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function CountdownTimer({ closesAt, serverTime }: CountdownTimerProps) {
  const { secondsRemaining, isExpired, isWarning } = useCountdown(
    closesAt,
    serverTime.getServerNow
  );

  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;

  if (isExpired) {
    return (
      <div
        role="timer"
        aria-live="assertive"
        className="agm-header__timer agm-header__timer--expired"
      >
        Voting has closed
      </div>
    );
  }

  return (
    <div
      role="timer"
      aria-live="polite"
      className={`agm-header__timer${isWarning ? " agm-header__timer--warning" : ""}`}
    >
      {isWarning && <span aria-hidden="true">! </span>}
      {pad(hours)}:{pad(minutes)}:{pad(seconds)}
    </div>
  );
}
