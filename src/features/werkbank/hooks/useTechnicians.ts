import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resendInvitation, revokeInvitation } from "@/data/invitations";
import { createTechnician, fetchTechnicians } from "../data/technicians";

export function useTechnicians(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["artists", "technicians", orgId],
    enabled: !!orgId,
    queryFn: () => fetchTechnicians(supabase, orgId!),
  });
}

/** Adds a technician and invites them. Settles with an `["artists"]` invalidation (domain
 *  prefix, so the pending-invite lists refresh too) even when the invite step fails after
 *  the row was saved. */
export function useCreateTechnician(orgId: string | null | undefined) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn: (vars: { name: string; email: string; phone: string | null }) =>
      createTechnician(supabase, { orgId: orgId!, ...vars }),
    onSuccess: () => toast.success(t("technicians.toast.added")),
    onError: () => toast.error(t("technicians.toast.addFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["artists"] }),
  });
}

/** Resend and revoke act on the pending invitation id. They call the data layer directly
 *  (not useInvitationMutations) so the toasts are translated and the technicians list
 *  refreshes. */
export function useTechnicianInvitationActions() {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["artists"] });
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
  };
  const resend = useMutation({
    mutationFn: (invitationId: string) => resendInvitation(supabase, invitationId),
    onSuccess: () => {
      refresh();
      toast.success(t("technicians.toast.resent"));
    },
    onError: () => toast.error(t("technicians.toast.resendFailed")),
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(supabase, invitationId),
    onSuccess: () => {
      refresh();
      toast.success(t("technicians.toast.revoked"));
    },
    onError: () => toast.error(t("technicians.toast.revokeFailed")),
  });
  return { resend, revoke };
}
