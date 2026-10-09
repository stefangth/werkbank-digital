let started = false;

/** Registers the service worker of the technician app (scope `/einsaetze`, see vite.config.ts).
 *  Called from the technician routes only, so office pages never register one. Updates install
 *  in the background (`registerType: "autoUpdate"`). */
export function registerServiceWorker(): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;
  import("virtual:pwa-register")
    .then(({ registerSW }) => { registerSW({ immediate: true }); })
    .catch(() => { started = false; });
}
