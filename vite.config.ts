import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import posthog from '@posthog/rollup-plugin';
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { readPostHogSourceMapOptions } from './scripts/posthogSourceMaps';

/**
 * The installable app of the phone routes under `scope`. Precaches only the app shell (no API
 * runtime caching; offline data comes from the query cache). `injectRegister: false`: nothing is
 * registered globally, the scoped pages register it themselves via `virtual:pwa-register`, so
 * every other page stays outside the service worker.
 */
function phoneAppPwa(scope: string, app: { name: string; shortName: string; iconDir: string; themeColor: string; lang: string }) {
  const startUrl = scope.replace(/\/$/, "");
  return VitePWA({
    injectRegister: false,
    registerType: "autoUpdate",
    strategies: "generateSW",
    scope,
    manifest: {
      name: app.name,
      short_name: app.shortName,
      start_url: startUrl,
      scope,
      display: "standalone",
      theme_color: app.themeColor,
      background_color: "#ffffff",
      lang: app.lang,
      icons: [192, 512].map((size) => ({ src: `${app.iconDir}/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png" })),
    },
    workbox: {
      navigateFallback: "/index.html",
      navigateFallbackAllowlist: [new RegExp(`^${startUrl}`)],
      runtimeCaching: [],
      // The shell must open offline, and the main app chunk is above workbox's 2 MiB default.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    },
  });
}

/**
 * Print which Supabase project the dev server is pointed at, so `npm run dev`
 * (LOCAL by default) vs `npm run dev:prod` is never ambiguous — for humans or
 * agents. Serve-mode only; never runs in a production build.
 */
function supabaseTargetBanner(url: string | undefined): Plugin {
  return {
    name: "supabase-target-banner",
    apply: "serve",
    configResolved() {
      if (!url) return;
      const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const isLocal = /127\.0\.0\.1|localhost/.test(host);
      const label = isLocal
        ? `LOCAL (${host})`
        : `PRODUCTION (${host.split(".")[0]})`;
      console.log(`\n▶ Supabase: ${label}\n`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const buildEnv = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const sourceMapOptions = readPostHogSourceMapOptions(mode, buildEnv);

  return {
    server: {
      host: "::",
      // 8080 by default, but honour PORT so two worktrees can run `npm run dev`
      // at once — a hardcoded port makes the second one fail to bind.
      port: Number(process.env.PORT) || 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      supabaseTargetBanner(buildEnv.VITE_SUPABASE_URL),
      // PWA manifest name of the fork.
      phoneAppPwa("/einsaetze/", { name: "Werkbank Digital", shortName: "Werkbank", iconDir: "/werkbank", themeColor: "#C2410C", lang: "de" }),
      ...(sourceMapOptions ? [posthog(sourceMapOptions)] : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
