import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  completeAssignment, createVisitReport, fetchAssignment, fetchAssignments, fetchTechnicianOrgs, lockVisitReport,
  removeVisitPhoto, signVisitReport, startAssignment, updateVisitReport, uploadVisitPhoto,
} from "../data/technicianApp";
import { mapDbError } from "../lib/dbErrors";
import { ORDERS_KEY } from "./useOrders";

export const ASSIGNMENTS_KEY = ["werkbank", "assignments"] as const;
export const TECHNICIAN_ORGS_KEY = ["werkbank", "technician-orgs"] as const;

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
 *  cache of another user is never read. */
export function useAssignments() {
  const { user, currentOrg } = useAuth();
  const userId = user?.id;
  const orgId = currentOrg?.id;
  return useQuery({
    queryKey: [...ASSIGNMENTS_KEY, userId, orgId], enabled: !!userId && !!orgId, queryFn: () => fetchAssignments(supabase, orgId!),
  });
}

export function useAssignment(orderId: string | undefined) {
  const { user, currentOrg } = useAuth();
  const userId = user?.id;
  const orgId = currentOrg?.id;
  return useQuery({
    queryKey: [...ASSIGNMENTS_KEY, userId, orgId, orderId], enabled: !!userId && !!orgId && !!orderId,
    queryFn: () => fetchAssignment(supabase, orderId!),
  });
}

/** One technician write: errors toast their translated copy; every outcome refreshes the given
 *  query domains (the assignments always, the office's orders too for status changes). */
function useTechnicianMutation<V, R>(mutationFn: (vars: V) => Promise<R>, keys: readonly (readonly string[])[] = [ASSIGNMENTS_KEY]) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn,
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] }))),
  });
}

/** Every technician write on one order. */
export function useAssignmentActions(orderId: string) {
  const orgId = useAuth().currentOrg?.id;
  return {
    start: useTechnicianMutation(() => startAssignment(supabase, orderId), [ASSIGNMENTS_KEY, ORDERS_KEY]),
    complete: useTechnicianMutation(() => completeAssignment(supabase, orderId), [ASSIGNMENTS_KEY, ORDERS_KEY]),
    createReport: useTechnicianMutation((visitDate?: string) => createVisitReport(supabase, orderId, visitDate)),
    updateReport: useTechnicianMutation((v: { reportId: string; body: string; visitDate: string }) =>
      updateVisitReport(supabase, v.reportId, v.body, v.visitDate)),
    addPhoto: useTechnicianMutation((v: { reportId: string; file: Blob; caption?: string }) =>
      uploadVisitPhoto(supabase, { orgId: orgId!, orderId, reportId: v.reportId, file: v.file, caption: v.caption })),
    removePhoto: useTechnicianMutation((photoId: string) => removeVisitPhoto(supabase, photoId)),
    lockReport: useTechnicianMutation((reportId: string) => lockVisitReport(supabase, reportId)),
    signReport: useTechnicianMutation((v: { reportId: string; signerName: string; png: Blob }) =>
      signVisitReport(supabase, { orgId: orgId!, orderId, reportId: v.reportId, signerName: v.signerName, png: v.png })),
  };
}
