import { ASSIGNMENTS_PATH } from "../paths";

let started = false;
let updatePending = false;
let reloadPage: () => void = () => window.location.reload();

/** The list page holds nothing a reload could lose: no report sheet, no signature, no form. */
const onListPage = () => window.location.pathname === ASSIGNMENTS_PATH;

/** Reloads into the new app version once one is waiting and the list page is shown. Called by the
 *  list page on every visit; a reload elsewhere could drop a report text or a signature. */
export function applyPendingUpdate(): void {
  if (!updatePending || !onListPage()) return;
  updatePending = false;
  reloadPage();
}

/** Registers the service worker of the technician app (scope `/einsaetze`, see vite.config.ts).
 *  Called from the technician routes only, so office pages never register one. Updates install
 *  in the background (`registerType: "autoUpdate"`), but the page is never reloaded mid-work
 *  (the plugin's default): the new version loads on the next visit of the list page, or when the
 *  app goes to the background while the list page is shown. Office pages of the same tab are
 *  never reloaded. */
export function registerServiceWorker(reload?: () => void): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;
  if (reload) reloadPage = reload;
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") applyPendingUpdate();
      });
      registerSW({ immediate: true, onNeedReload: () => { updatePending = true; } });
    })
    .catch(() => { started = false; });
}
