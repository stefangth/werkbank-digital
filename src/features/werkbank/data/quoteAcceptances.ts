import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type QuoteAcceptance = Database["werkbank"]["Tables"]["quote_acceptances"]["Row"];

type Client = SupabaseClient<Database>;
const BUCKET = "werkbank-documents";
const SIGNED_URL_SECONDS = 600;

/** The decisions a customer made on one quote, oldest first (admin and producer only, by RLS). */
export async function fetchQuoteAcceptances(client: Client, quoteId: string): Promise<QuoteAcceptance[]> {
  const { data, error } = await client.schema("werkbank").from("quote_acceptances")
    .select("*").eq("quote_id", quoteId).order("decided_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Short-lived URL of a stored signature image. */
export async function signatureUrl(client: Client, path: string): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
