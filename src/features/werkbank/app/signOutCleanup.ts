import type { QueryClient } from "@tanstack/react-query";
import { clearAssignmentCache } from "../lib/idbPersister";
import { clearUploadedSignatures } from "./signatureStore";

interface AuthEvents {
  onAuthStateChange: (callback: (event: string) => void) => unknown;
}

/** The auth clients already watched: one subscription per client for the life of the tab. */
const watched = new WeakSet<object>();
/** The query client of the latest technician app mount; the one a sign out must empty. */
let appQueryClient: QueryClient | null = null;

/** Spec R5 for every way out, not only the app's own sign out button (MobileShell): a sign out
 *  from an office page, another tab or an expired session also drops the offline copy, the
 *  werkbank queries held for offline use and any stored signature, so the next user of a shared
 *  phone finds nothing. Called by AssignmentCacheProvider; repeated calls only swap the client.
 *  A tab that never opened the technician app does not listen; whatever the store holds then
 *  stays until the next open, which prunes other users' and expired entries first. */
export function watchSignOut(auth: AuthEvents, queryClient: QueryClient): void {
  appQueryClient = queryClient;
  if (watched.has(auth)) return;
  watched.add(auth);
  auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT") return;
    void clearAssignmentCache().catch((e) => console.warn("werkbank: offline copy not cleared on sign out, the next app open prunes it", e));
    // Every technician query (assignments, signed URLs) is keyed under "werkbank"; a new one must be too.
    appQueryClient?.removeQueries({ queryKey: ["werkbank"] });
    clearUploadedSignatures();
  });
}
