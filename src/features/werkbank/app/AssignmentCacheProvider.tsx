import { useEffect, useState, type ReactNode } from "react";
import { IsRestoringProvider, defaultShouldDehydrateQuery, useQueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { APP_META } from "@/config/app.config";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { AssignmentRow } from "../data/technicianApp";
import { ASSIGNMENTS_KEY } from "../hooks/useAssignments";
import { offlineOrderIds, shouldPersistQuery } from "../lib/assignments";
import { assignmentCacheKey, createIdbPersister, pruneAssignmentCache, trackPersistence } from "../lib/idbPersister";
import { OFFLINE_MAX_AGE_MS } from "../lib/visitDefaults";
import { registerServiceWorker } from "./registerServiceWorker";
import { watchSignOut } from "./signOutCleanup";

/** Offline reading for the technician routes only: restores the signed-in user's cached
 *  assignments from IndexedDB into the app's query client, then keeps that copy current. The
 *  store is keyed by user id; a cache of another app version or older than seven days is dropped.
 *  Queries wait while the cache is restored, so they start from it instead of a spinner. */
export function AssignmentCacheProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const userId = useAuth().user?.id;
  // Restoring until the cache of the current user is in; no user, nothing to restore.
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const restoring = !!userId && restoredFor !== userId;

  useEffect(() => { registerServiceWorker(); }, []);
  // Any sign out, not only the shell's button, empties the offline copy (spec R5).
  useEffect(() => { watchSignOut(supabase.auth, qc); }, [qc]);

  useEffect(() => {
    if (!userId) return;
    // Restored queries have no observer yet; they must outlive the default gc time to be persisted again.
    qc.setQueryDefaults([...ASSIGNMENTS_KEY], { gcTime: OFFLINE_MAX_AGE_MS });
    // Other users' and expired entries go before this user's copy is restored (a shared phone, a
    // session that ended without a sign out).
    void pruneAssignmentCache(userId, OFFLINE_MAX_AGE_MS).catch(() => undefined);
    const [unsubscribe, restored] = persistQueryClient({
      queryClient: qc,
      persister: createIdbPersister(assignmentCacheKey(userId)),
      maxAge: OFFLINE_MAX_AGE_MS,
      buster: APP_META.VERSION,
      dehydrateOptions: {
        shouldDehydrateMutation: () => false,
        shouldDehydrateQuery: (query) => {
          if (!defaultShouldDehydrateQuery(query)) return false;
          // The list of the same user and org decides which details are offline orders.
          const list = qc.getQueryData<AssignmentRow[]>(query.queryKey.slice(0, 4));
          return shouldPersistQuery(query, offlineOrderIds(Array.isArray(list) ? list : []), userId);
        },
      },
    });
    const stop = trackPersistence(userId, unsubscribe);
    let live = true;
    restored.catch(() => undefined).finally(() => { if (live) setRestoredFor(userId); });
    return () => {
      live = false;
      stop();
    };
  }, [qc, userId]);

  return <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>;
}
