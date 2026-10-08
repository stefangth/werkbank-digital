import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import posthog from '@posthog/rollup-plugin';
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { readPostHogSourceMapOptions } from './scripts/posthogSourceMaps';
import { phoneAppPwaOptions } from './scripts/phoneAppPwa';

/** Scope and start page of the technician app (the fork's phone routes). */
export const PHONE_APP_SCOPE = "/einsaetze";

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
      VitePWA(phoneAppPwaOptions(PHONE_APP_SCOPE, {
        name: "Werkbank Digital", shortName: "Werkbank", iconDir: "/werkbank", themeColor: "#C2410C", lang: "de",
      })),
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
