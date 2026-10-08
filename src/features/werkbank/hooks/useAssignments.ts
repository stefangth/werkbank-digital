import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  completeAssignment, createVisitReport, fetchAssignment, fetchAssignments, fetchTechnicianOrgs, lockVisitReport,
  removeVisitPhoto, signVisitReport, startAssignment, updateVisitReport, uploadVisitPhoto, visitObjectUrls,
} from "../data/technicianApp";
import { offlineOrderIds } from "../lib/assignments";
import { mapDbError, type DbErrorKey } from "../lib/dbErrors";
import { OFFLINE_MAX_AGE_MS } from "../lib/visitDefaults";
import { ORDERS_KEY } from "./useOrders";

export const ASSIGNMENTS_KEY = ["werkbank", "assignments"] as const;
export const TECHNICIAN_ORGS_KEY = ["werkbank", "technician-orgs"] as const;
/** Outside the assignments domain on purpose: signed URLs expire and are never persisted offline. */
export const VISIT_OBJECT_URLS_KEY = ["werkbank", "visit-object-urls"] as const;
/** Refetched before the 300 s signed URLs run out. */
const OBJECT_URL_STALE_MS = 240_000;
/** Offline reading (R5): cached data first, the network after; kept in memory as long as the
 *  persisted copy lives, so the persist filter still finds the prefetched details. */
const OFFLINE_QUERY = { networkMode: "offlineFirst", gcTime: OFFLINE_MAX_AGE_MS } as const;
/** A prefetched detail younger than this is not fetched again on every list refresh. */
const PREFETCH_STALE_MS = 60_000;

/** Orgs where the signed-in user is a technician. */
export function useTechnicianOrgs() {
  const userId = useAuth().user?.id;
  return useQuery({
    queryKey: [...TECHNICIAN_ORGS_KEY, userId], enabled: !!userId, queryFn: () => fetchTechnicianOrgs(supabase),
  });
}

/** Whether the user is a technician in the active org; undefined while that is unknown. */
export function useIsTechnicianHere(): boolean | undefined {
  const orgId = useAuth().currentOrg?.id;
  const { data } = useTechnicianOrgs();
  if (!orgId || !data) return undefined;
  return data.includes(orgId);
}

/** The caller's assigned orders in the active org. The key carries the user id, so a persisted
 *  cache of another user is never read. Once the list is in, the details of the overdue, today
 *  and upcoming orders are prefetched so they open offline too. */
export function useAssignments() {
  const qc = useQueryClient();
  const { user, currentOrg } = useAuth();
  const userId = user?.id;
  const orgId = currentOrg?.id;
  const query = useQuery({
    ...OFFLINE_QUERY,
    queryKey: [...ASSIGNMENTS_KEY, userId, orgId], enabled: !!userId && !!orgId, queryFn: () => fetchAssignments(supabase, orgId!),
  });
  const { data } = query;
  useEffect(() => {
    if (!data) return;
    for (const orderId of offlineOrderIds(data)) {
      void qc.prefetchQuery({
        ...OFFLINE_QUERY, staleTime: PREFETCH_STALE_MS,
        queryKey: [...ASSIGNMENTS_KEY, userId, orgId, orderId], queryFn: () => fetchAssignment(supabase, orderId),
      });
    }
  }, [data, qc, userId, orgId]);
  return query;
}

export function useAssignment(orderId: string | undefined) {
  const { user, currentOrg } = useAuth();
  const userId = user?.id;
  const orgId = currentOrg?.id;
  return useQuery({
    ...OFFLINE_QUERY,
    queryKey: [...ASSIGNMENTS_KEY, userId, orgId, orderId], enabled: !!userId && !!orgId && !!orderId,
    queryFn: () => fetchAssignment(supabase, orderId!),
  });
}

/** Signed URLs for visit photos and signatures, by path. Offline the query fails and the caller
 *  shows a placeholder. */
export function useVisitObjectUrls(paths: string[]) {
  const sorted = [...paths].sort();
  return useQuery({
    queryKey: [...VISIT_OBJECT_URLS_KEY, ...sorted], enabled: sorted.length > 0, staleTime: OBJECT_URL_STALE_MS,
    refetchInterval: OBJECT_URL_STALE_MS, queryFn: () => visitObjectUrls(supabase, sorted),
  });
}

class OfflineWriteError extends Error {
  constructor() { super("offline"); }
}

/** One technician write: errors toast their translated copy (except the `silent` keys); every outcome refreshes the given
 *  query domains (the assignments always, the office's orders too for status changes). */
function useTechnicianMutation<V, R>(
  mutationFn: (vars: V) => Promise<R>,
  keys: readonly (readonly string[])[] = [ASSIGNMENTS_KEY],
  /** Errors the caller handles itself after the refetch, so no toast here. */
  silent: readonly DbErrorKey[] = [],
) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    // Writes need the server: offline they fail at once instead of queueing for later.
    networkMode: "always",
    mutationFn: (vars: V) => (navigator.onLine ? mutationFn(vars) : Promise.reject(new OfflineWriteError())),
    onError: (e) => {
      if (e instanceof OfflineWriteError) return void toast.error(t("app.offline.needsNetwork"));
      const key = mapDbError(e);
      if (!silent.includes(key)) toast.error(t(key));
    },
    onSettled: () => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] }))),
  });
}

/** Every technician write on one order. */
export function useAssignmentActions(orderId: string) {
  const orgId = useAuth().currentOrg?.id;
  return {
    start: useTechnicianMutation(() => startAssignment(supabase, orderId), [ASSIGNMENTS_KEY, ORDERS_KEY]),
    complete: useTechnicianMutation(() => completeAssignment(supabase, orderId), [ASSIGNMENTS_KEY, ORDERS_KEY], ["errors.invalidTransition"]),
    createReport: useTechnicianMutation((visitDate?: string) => createVisitReport(supabase, orderId, visitDate)),
    updateReport: useTechnicianMutation((v: { reportId: string; body: string; visitDate: string }) =>
      updateVisitReport(supabase, v.reportId, v.body, v.visitDate)),
    addPhoto: useTechnicianMutation((v: { reportId: string; file: Blob; caption?: string }) =>
      uploadVisitPhoto(supabase, { orgId: orgId!, orderId, reportId: v.reportId, file: v.file, caption: v.caption })),
    removePhoto: useTechnicianMutation((photoId: string) => removeVisitPhoto(supabase, photoId)),
    lockReport: useTechnicianMutation((reportId: string) => lockVisitReport(supabase, reportId)),
    signReport: useTechnicianMutation((v: { reportId: string; signerName: string; png: Blob; uploaded?: boolean }) =>
      signVisitReport(supabase, { orgId: orgId!, orderId, ...v })),
  };
}
