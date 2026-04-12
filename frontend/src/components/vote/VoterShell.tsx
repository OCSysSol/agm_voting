import { Outlet } from "react-router-dom";
import { useBranding } from "../../context/BrandingContext";

export function VoterShell() {
  const { config, effectiveLogoUrl } = useBranding();

  return (
    <div className="voter-layout">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="app-header">
        {/* Fix 11: always render an img using effectiveLogoUrl (OCSS fallback when no logo configured) */}
        <img src={effectiveLogoUrl} alt={config.app_name} className="app-header__logo" />
      </header>
      <main id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
