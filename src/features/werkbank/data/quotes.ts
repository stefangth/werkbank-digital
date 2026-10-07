import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, format, parseISO } from "date-fns";
import type { Database } from "@/integrations/supabase/types";
import { berlinDateKey } from "@/lib/dates";
import { fetchAllPages } from "../lib/fetchAllPages";
import type { CompanyProfile } from "./companyProfile";

export type Quote = Database["werkbank"]["Tables"]["quotes"]["Row"];
export type QuoteListRow = Database["werkbank"]["Views"]["quote_list"]["Row"];
export type DocumentTotals = Database["werkbank"]["Views"]["document_totals"]["Row"];
export type QuoteWithTotals = Quote & { totals: DocumentTotals | null };

/** The fields a user fills in; quote_no, status and the send columns are service-only. */
export type QuoteDraft = {
  customer_id: string;
  property_id?: string | null;
  contact_id?: string | null;
  location_note?: string | null;
  subject?: string | null;
  discount_percent?: number;
};
export type QuotePatch = Partial<QuoteDraft> & {
  intro_text?: string | null;
  closing_text?: string | null;
  payment_terms_text?: string | null;
  valid_until?: string;
};
/** What a new quote takes from the company profile. */
export type QuoteDefaults = Pick<CompanyProfile, "quote_intro" | "quote_closing" | "payment_terms_text" | "quote_validity_days">;

/** `copy_quote` takes nullable `p_customer`/`p_property` (CALLED ON NULL INPUT) that the
 *  generated types cannot express, so the args are widened here and cast at the call. */
type CopyQuoteArgs = { p_quote: string; p_customer?: string | null; p_property?: string | null };

type Client = SupabaseClient<Database>;
type QuoteInsert = Database["werkbank"]["Tables"]["quotes"]["Insert"];
const DEFAULT_VALIDITY_DAYS = 30;

/** All quotes of the org with customer, property and totals, newest first. */
export async function fetchQuoteList(client: Client, orgId: string): Promise<QuoteListRow[]> {
  return fetchAllPages<QuoteListRow>((from, to) =>
    client.schema("werkbank").from("quote_list").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: QuoteListRow[] | null; error: unknown }>,
  );
}

/** One quote with its totals (null totals while it has no items), or null if missing. */
export async function fetchQuote(client: Client, id: string): Promise<QuoteWithTotals | null> {
  const werkbank = client.schema("werkbank");
  const [quote, totals] = await Promise.all([
    werkbank.from("quotes").select("*").eq("id", id).maybeSingle(),
    werkbank.from("document_totals").select("*").eq("quote_id", id).maybeSingle(),
  ]);
  if (quote.error) throw quote.error;
  if (totals.error) throw totals.error;
  return quote.data ? { ...quote.data, totals: totals.data } : null;
}

/** Today (Berlin) plus the validity days. */
export function defaultValidUntil(validityDays: number, now = new Date()): string {
  return format(addDays(parseISO(berlinDateKey(now)), validityDays), "yyyy-MM-dd");
}

/** Creates a draft, prefilled from the company profile. The database assigns `quote_no`. */
export async function createQuote(client: Client, orgId: string, draft: QuoteDraft, profile: QuoteDefaults | null): Promise<string> {
  const { data, error } = await client.schema("werkbank").from("quotes")
    .insert({
      ...draft,
      org_id: orgId,
      intro_text: profile?.quote_intro ?? null,
      closing_text: profile?.quote_closing ?? null,
      payment_terms_text: profile?.payment_terms_text ?? null,
      valid_until: defaultValidUntil(profile?.quote_validity_days ?? DEFAULT_VALIDITY_DAYS),
    } as QuoteInsert) // quote_no, status, version: assigned by the database
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateQuote(client: Client, id: string, patch: QuotePatch): Promise<void> {
  const { error } = await client.schema("werkbank").from("quotes").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteQuote(client: Client, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("quotes").delete().eq("id", id);
  if (error) throw error;
}

/** Allowed on a sent quote too (`valid_until` is one of the two unlocked columns). */
export async function extendQuote(client: Client, id: string, validUntil: string): Promise<void> {
  await updateQuote(client, id, { valid_until: validUntil });
}

export async function revokeQuoteLink(client: Client, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("quotes").update({ link_revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Creates the next version as a draft and returns its id. */
export async function reviseQuote(client: Client, id: string): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("revise_quote", { p_quote: id });
  if (error) throw error;
  return data;
}

/** Copies a quote as a new draft, optionally for another customer or property. */
export async function copyQuote(client: Client, id: string, opts: { customerId?: string | null; propertyId?: string | null } = {}): Promise<string> {
  const args: CopyQuoteArgs = { p_quote: id };
  if (opts.customerId !== undefined) args.p_customer = opts.customerId;
  if (opts.propertyId !== undefined) args.p_property = opts.propertyId;
  const { data, error } = await client.schema("werkbank").rpc("copy_quote", args as Database["werkbank"]["Functions"]["copy_quote"]["Args"]);
  if (error) throw error;
  return data;
}
