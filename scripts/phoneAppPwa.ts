import type { VitePWAOptions } from "vite-plugin-pwa";

export interface PhoneApp {
  name: string;
  shortName: string;
  iconDir: string;
  themeColor: string;
  lang: string;
}

/**
 * Options of the installable app of the phone routes under `scope`. Precaches only the app shell
 * (no API runtime caching; offline data comes from the query cache). `injectRegister: false`:
 * nothing is registered globally, the scoped pages register it themselves via
 * `virtual:pwa-register`, so every other page stays outside the service worker.
 *
 * The scope has no trailing slash: with `/x/` the list page `/x` (the manifest's start_url) would
 * lie outside the scope and not be controlled, so the app's start page would not open offline.
 */
export function phoneAppPwaOptions(scope: string, app: PhoneApp): Partial<VitePWAOptions> {
  if (!/^\/[^/]+(\/[^/]+)*$/.test(scope)) throw new Error(`PWA scope must look like /path without a trailing slash: ${scope}`);
  const escaped = scope.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return {
    injectRegister: false,
    registerType: "autoUpdate",
    strategies: "generateSW",
    scope,
    manifest: {
      name: app.name,
      short_name: app.shortName,
      start_url: scope,
      scope,
      display: "standalone",
      theme_color: app.themeColor,
      background_color: "#ffffff",
      lang: app.lang,
      icons: [192, 512].map((size) => ({ src: `${app.iconDir}/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png" })),
    },
    workbox: {
      navigateFallback: "/index.html",
      // The scope itself and everything below it, but not `/xyz` for scope `/x`.
      navigateFallbackAllowlist: [new RegExp(`^${escaped}(\\/|$)`)],
      runtimeCaching: [],
      // The shell must open offline, and the main app chunk is above workbox's 2 MiB default.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    },
  };
}
