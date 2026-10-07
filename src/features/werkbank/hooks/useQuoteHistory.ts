import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchQuoteAcceptances, signatureUrl } from "../data/quoteAcceptances";
import { QUOTES_KEY } from "./useQuotes";

export function useQuoteAcceptances(quoteId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...QUOTES_KEY, "acceptances", quoteId],
    enabled: !!quoteId && enabled,
    queryFn: () => fetchQuoteAcceptances(supabase, quoteId!),
  });
}

/** Signed URL of a signature image; refreshed before the 600 s expiry. */
export function useSignatureUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: [...QUOTES_KEY, "signature-url", path],
    enabled: !!path,
    staleTime: 5 * 60 * 1000,
    queryFn: () => signatureUrl(supabase, path!),
  });
}
