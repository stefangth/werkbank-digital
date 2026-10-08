import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";

export type DunningNotice = Database["werkbank"]["Tables"]["dunning_notices"]["Row"];
export type DunningHold = Database["werkbank"]["Tables"]["dunning_holds"]["Row"];
export type DunningDueRow = Database["werkbank"]["Views"]["dunning_due"]["Row"];

type Client = SupabaseClient<Database>;

/** The notices sent or drafted for an invoice, stage 1 first. */
export async function fetchDunningNotices(client: Client, orgId: string, invoiceId: string): Promise<DunningNotice[]> {
  const { data, error } = await client.schema("werkbank").from("dunning_notices").select("*")
    .eq("org_id", orgId).eq("invoice_id", invoiceId).order("stage", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** The hold on an invoice (it may be expired; the views decide), or null. */
export async function fetchDunningHold(client: Client, orgId: string, invoiceId: string): Promise<DunningHold | null> {
  const { data, error } = await client.schema("werkbank").from("dunning_holds").select("*")
    .eq("org_id", orgId).eq("invoice_id", invoiceId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Invoices that are due their next notice, most overdue first. */
export async function fetchDunningDue(client: Client, orgId: string): Promise<DunningDueRow[]> {
  return fetchAllPages<DunningDueRow>((from, to) => client.schema("werkbank").from("dunning_due").select("*")
    .eq("org_id", orgId).order("days_overdue", { ascending: false }).order("invoice_id")
    .range(from, to) as unknown as PromiseLike<{ data: DunningDueRow[] | null; error: unknown }>);
}

/** Pauses dunning for an invoice, optionally until a Berlin date (YYYY-MM-DD). */
export async function setDunningHold(client: Client, invoiceId: string, reason: string, until: string | null): Promise<void> {
  const { error } = await client.schema("werkbank").rpc("set_dunning_hold", { p_invoice: invoiceId, p_reason: reason, p_until: until ?? undefined });
  if (error) throw error;
}

export async function clearDunningHold(client: Client, invoiceId: string): Promise<void> {
  const { error } = await client.schema("werkbank").rpc("clear_dunning_hold", { p_invoice: invoiceId });
  if (error) throw error;
}
