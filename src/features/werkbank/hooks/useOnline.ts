import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { ASSIGNMENTS_KEY } from "./useAssignments";

/** A fetch that never reached the server (supabase-js wraps the browser's TypeError). */
function isNetworkFailure(e: unknown): boolean {
  const message = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}

/** Whether the technician app has a connection: the browser's flag and events, plus the last
 *  list fetch failing on the network. `lastSync` is the time of the last successful list fetch,
 *  restored from the offline cache too. */
export function useOnline(): { online: boolean; lastSync: Date | null } {
  const qc = useQueryClient();
  const { user, currentOrg } = useAuth();
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const userId = user?.id;
  const orgId = currentOrg?.id;
  const subscribe = useCallback((onChange: () => void) => qc.getQueryCache().subscribe(onChange), [qc]);
  const getState = useCallback(() => qc.getQueryState([...ASSIGNMENTS_KEY, userId, orgId]), [qc, userId, orgId]);
  const state = useSyncExternalStore(subscribe, getState);

  const failedOnNetwork = !!state && state.fetchFailureCount > 0 && isNetworkFailure(state.fetchFailureReason);
  return {
    online: browserOnline && !failedOnNetwork,
    lastSync: state?.dataUpdatedAt ? new Date(state.dataUpdatedAt) : null,
  };
}
