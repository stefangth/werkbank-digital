import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  copyQuote, createQuote, deleteQuote, extendQuote, fetchQuote, fetchQuoteList, reviseQuote,
  revokeQuoteLink, updateQuote, type QuoteDefaults, type QuoteDraft, type QuotePatch,
} from "../data/quotes";
import { mapDbError } from "../lib/dbErrors";
import { RANGES_KEY } from "./useNumberRanges";

export const QUOTES_KEY = ["werkbank", "quotes"] as const;

export function useQuoteList() {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...QUOTES_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => fetchQuoteList(supabase, orgId!),
  });
}

export function useQuote(id: string | undefined) {
  return useQuery({
    queryKey: [...QUOTES_KEY, "detail", id],
    enabled: !!id,
    queryFn: () => fetchQuote(supabase, id!),
  });
}

/** All quote mutations: a database error toasts its translated copy, and every outcome
 *  refreshes the quotes domain (list and detail). Creating, revising and copying draw a number,
 *  so the numbering tab is refreshed as well. */
export function useQuoteMutations() {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");

  function useWiring<V, R>(mutationFn: (vars: V) => Promise<R>, drawsNumber = false) {
    return useMutation({
      mutationFn,
      onError: (e) => toast.error(t(mapDbError(e))),
      onSettled: () =>
        Promise.all([QUOTES_KEY, ...(drawsNumber ? [RANGES_KEY] : [])].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    });
  }

  return {
    create: useWiring((vars: { draft: QuoteDraft; profile: QuoteDefaults | null }) => createQuote(supabase, orgId!, vars.draft, vars.profile), true),
    update: useWiring((vars: { id: string; patch: QuotePatch }) => updateQuote(supabase, vars.id, vars.patch)),
    remove: useWiring((id: string) => deleteQuote(supabase, id)),
    extend: useWiring((vars: { id: string; validUntil: string }) => extendQuote(supabase, vars.id, vars.validUntil)),
    revokeLink: useWiring((id: string) => revokeQuoteLink(supabase, id)),
    revise: useWiring((id: string) => reviseQuote(supabase, id), true),
    copy: useWiring((vars: { id: string; customerId?: string | null; propertyId?: string | null }) =>
      copyQuote(supabase, vars.id, { customerId: vars.customerId, propertyId: vars.propertyId }), true),
  };
}
