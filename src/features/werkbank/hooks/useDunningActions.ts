import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { dunningDownloadUrl, issueDunning, previewDunning, sendDunning, type DunningRecipients } from "../data/dunningActions";
import { INVOICES_KEY } from "./useInvoices";
import { OPEN_ITEMS_KEY } from "./useOpenItems";

function useRefresh() {
  const qc = useQueryClient();
  // Also after a failure: render_failed and send_failed leave the notice created.
  return () => Promise.all([OPEN_ITEMS_KEY, INVOICES_KEY].map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/** Errors are left to the caller, which shows them in context (DunningActionError). */
export function useIssueDunning() {
  const orgId = useAuth().currentOrg?.id;
  return useMutation({
    mutationFn: (v: { invoiceId: string; delivery: "email" | "print"; paymentDeadline?: string; send?: DunningRecipients }) =>
      issueDunning(supabase, { orgId: orgId!, ...v }),
    onSettled: useRefresh(),
  });
}

export function useSendDunning() {
  const orgId = useAuth().currentOrg?.id;
  return useMutation({
    mutationFn: (v: { noticeId: string } & DunningRecipients) => sendDunning(supabase, { orgId: orgId!, ...v }),
    onSettled: useRefresh(),
  });
}

/** Resolves to the watermarked PDF bytes of the next notice. */
export function usePreviewDunning() {
  const orgId = useAuth().currentOrg?.id;
  return useMutation({
    mutationFn: (v: { invoiceId: string; paymentDeadline?: string }) => previewDunning(supabase, { orgId: orgId!, ...v }),
  });
}

export function useDunningDownload() {
  const orgId = useAuth().currentOrg?.id;
  return useMutation({ mutationFn: (noticeId: string) => dunningDownloadUrl(supabase, orgId!, noticeId) });
}
