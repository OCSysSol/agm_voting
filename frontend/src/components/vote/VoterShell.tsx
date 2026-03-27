import { Outlet } from "react-router-dom";
import { useBranding } from "../../context/BrandingContext";

export function VoterShell() {
  const { config } = useBranding();

  return (
    <div className="voter-layout">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="app-header">
        {config.logo_url ? (
          <img src={config.logo_url} alt={config.app_name} className="app-header__logo" />
        ) : (
          <span className="app-header__app-name">{config.app_name}</span>
        )}
      </header>
      <main id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
