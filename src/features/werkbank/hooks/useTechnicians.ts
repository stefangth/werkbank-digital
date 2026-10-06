import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inviteArtistToApp, resendInvitation, revokeInvitation } from "@/data/invitations";
import { TechnicianInviteError, createTechnician, fetchTechnicians } from "../data/technicians";

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
    onError: (e) =>
      toast.error(
        e instanceof TechnicianInviteError ? t("technicians.toast.savedInviteFailed") : t("technicians.toast.saveFailed"),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ["artists"] }),
  });
}

/** Invite (a technician without a pending invite), resend and revoke (by pending invitation id). They call the data layer directly
 *  (not useInvitationMutations) so the toasts are translated and the technicians list
 *  refreshes. */
export function useTechnicianInvitationActions(orgId: string | null | undefined) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["artists"] });
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
  };
  const invite = useMutation({
    mutationFn: (vars: { artistId: string; email: string }) =>
      inviteArtistToApp(supabase, { orgId: orgId!, ...vars }),
    onSuccess: () => {
      refresh();
      toast.success(t("technicians.toast.invited"));
    },
    onError: () => toast.error(t("technicians.toast.inviteFailed")),
  });
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
  return { invite, resend, revoke };
}
