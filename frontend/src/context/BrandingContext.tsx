import { createContext, useContext, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TenantConfig } from "../api/config";
import { getPublicConfig } from "../api/config";

// Fix 11: OCSS fallback URLs used when no branding is configured
export const FALLBACK_LOGO_URL =
  "https://sentw3x37yabsacv.public.blob.vercel-storage.com/ocss-logo-C9E81q9ZrYhx9aARiYOvaF3gn1cqp1.svg";
export const FALLBACK_FAVICON_URL =
  "https://sentw3x37yabsacv.public.blob.vercel-storage.com/ocss-favicon-4CMVReCEFGq06d9bG9Q8NqTrZqRosj.svg";

export const DEFAULT_CONFIG: TenantConfig = {
  app_name: "General Meeting",
  logo_url: FALLBACK_LOGO_URL,
  favicon_url: FALLBACK_FAVICON_URL,
  primary_colour: "#005f73",
  support_email: "",
};

interface BrandingContextValue {
  config: TenantConfig;
  isLoading: boolean;
  effectiveLogoUrl: string;
  effectiveFaviconUrl: string;
}

export const BrandingContext = createContext<BrandingContextValue>({
  config: DEFAULT_CONFIG,
  isLoading: true,
  effectiveLogoUrl: FALLBACK_LOGO_URL,
  effectiveFaviconUrl: FALLBACK_FAVICON_URL,
});

export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-config"],
    queryFn: getPublicConfig,
    // Branding rarely changes; long stale time reduces noise, but invalidation
    // from SettingsPage.handleSubmit will still trigger an immediate re-fetch.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // On error fall back to defaults — app remains fully functional.
  const config = (isError || !data) ? DEFAULT_CONFIG : data;

  // Fix 11: derive effective URLs so consumers never need to reimplement fallback logic
  const effectiveLogoUrl = config.logo_url || FALLBACK_LOGO_URL;
  const effectiveFaviconUrl = config.favicon_url || FALLBACK_FAVICON_URL;

  useEffect(() => {
    if (data) {
      document.documentElement.style.setProperty("--color-primary", data.primary_colour);
      document.title = data.app_name;
      const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (link) {
        // favicon_url takes priority; fall back to logo_url; then OCSS fallback favicon
        if (data.favicon_url) {
          link.href = data.favicon_url;
        } else if (data.logo_url) {
          link.href = data.logo_url;
        } else {
          link.href = FALLBACK_FAVICON_URL;
        }
      }
    }
  }, [data]);

  return (
    <BrandingContext.Provider value={{ config, isLoading, effectiveLogoUrl, effectiveFaviconUrl }}>
      {children}
    </BrandingContext.Provider>
  );
}
