import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { previewQuote, quoteDownloadUrl, resendQuote, sendQuote, type SendBody } from "../data/quoteActions";
import { QUOTES_KEY } from "./useQuotes";

/** The edge-backed quote actions. Errors are left to the caller, which shows them in context
 *  (inside the dialog, or as a toast). Send and resend refresh the quotes domain. */
export function useQuoteActions() {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: QUOTES_KEY });

  return {
    preview: useMutation({ mutationFn: (quoteId: string) => previewQuote(supabase, orgId!, quoteId) }),
    send: useMutation({
      mutationFn: (vars: { quoteId: string; body: SendBody }) => sendQuote(supabase, orgId!, vars.quoteId, vars.body),
      onSettled: refresh,
    }),
    resend: useMutation({
      mutationFn: (vars: { quoteId: string; body: SendBody }) => resendQuote(supabase, orgId!, vars.quoteId, vars.body),
      onSettled: refresh,
    }),
    download: useMutation({
      mutationFn: (vars: { quoteId: string; kind: "sent" | "accepted" }) => quoteDownloadUrl(supabase, orgId!, vars.quoteId, vars.kind),
    }),
  };
}
