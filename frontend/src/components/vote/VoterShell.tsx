import { Outlet } from "react-router-dom";

export function VoterShell() {
  return (
    <div className="voter-layout">
      <header className="app-header">
        <span className="app-header__brand">
          AGM<span className="app-header__dot">·</span>Vote
        </span>
      </header>
      <Outlet />
    </div>
  );
}
