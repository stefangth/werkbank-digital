import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { downloadVisitReportPdf, fetchVisitReports, updateOfficeNote } from "../data/visitReports";
import { mapDbError } from "../lib/dbErrors";

export const VISIT_REPORTS_KEY = ["werkbank", "visit-reports"] as const;

/** The visit reports of an order, for the office. */
export function useVisitReports(orderId: string | undefined) {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...VISIT_REPORTS_KEY, orgId, orderId], enabled: !!orgId && !!orderId, queryFn: () => fetchVisitReports(supabase, orgId!, orderId!),
  });
}

export function useUpdateOfficeNote(_orderId: string) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn: (v: { reportId: string; note: string | null }) => updateOfficeNote(supabase, v.reportId, v.note),
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () => qc.invalidateQueries({ queryKey: [...VISIT_REPORTS_KEY] }),
  });
}

/** The visit report PDF of an order (all reports, or the given ones); resolves to the bytes. */
export function useVisitReportPdf(orderId: string) {
  const orgId = useAuth().currentOrg?.id;
  return useMutation({
    mutationFn: (reportIds?: string[]) => downloadVisitReportPdf(supabase, { orgId: orgId!, orderId, reportIds }),
  });
}
