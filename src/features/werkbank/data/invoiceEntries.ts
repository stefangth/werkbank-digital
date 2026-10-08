import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import type { InvoiceListRow } from "./invoices";

export type InvoiceEntry = Database["werkbank"]["Tables"]["invoice_entries"]["Row"];
export type InvoiceBalance = Database["werkbank"]["Views"]["invoice_balances"]["Row"];
export type EntryKind = "payment" | "refund" | "write_off";
export type WriteOffReason = "skonto" | "goodwill" | "bad_debt" | "other";

type Client = SupabaseClient<Database>;
type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Keeps a search term from breaking out of the PostgREST `or(...)` filter. */
function safeTerm(term: string): string {
  return term.replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim();
}

/** The payment state of one invoice, or null if it has none (draft, cancellation, other org). */
export async function fetchInvoiceBalance(client: Client, orgId: string, invoiceId: string): Promise<InvoiceBalance | null> {
  const { data, error } = await client.schema("werkbank").from("invoice_balances").select("*")
    .eq("org_id", orgId).eq("invoice_id", invoiceId).maybeSingle();
  if (error) throw error;
  return data;
}

/** The ledger of an invoice, oldest first. */
export async function fetchInvoiceEntries(client: Client, orgId: string, invoiceId: string): Promise<InvoiceEntry[]> {
  return fetchAllPages<InvoiceEntry>((from, to) => client.schema("werkbank").from("invoice_entries").select("*")
    .eq("org_id", orgId).eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true }).order("id").range(from, to) as unknown as Page<InvoiceEntry>);
}

/** Invoices with something open (or in credit), most overdue first. */
export async function fetchOpenItems(
  client: Client,
  orgId: string,
  q: { search: string; customerId?: string; overdueOnly?: boolean },
): Promise<InvoiceBalance[]> {
  const term = safeTerm(q.search);
  return fetchAllPages<InvoiceBalance>((from, to) => {
    let query = client.schema("werkbank").from("invoice_balances").select("*").eq("org_id", orgId).neq("open_amount", 0);
    if (q.customerId) query = query.eq("customer_id", q.customerId);
    if (q.overdueOnly) query = query.gt("days_overdue", 0);
    if (term) {
      const p = `%${term}%`;
      query = query.or(`invoice_no.ilike.${p},customer_name.ilike.${p},property_name.ilike.${p}`);
    }
    return query.order("days_overdue", { ascending: false }).order("invoice_id").range(from, to) as unknown as Page<InvoiceBalance>;
  });
}

/** The total credit customers hold with the org (sum of negative open amounts), as a positive number. */
export async function fetchCustomerCredit(client: Client, orgId: string): Promise<number> {
  const rows = await fetchAllPages<Pick<InvoiceBalance, "open_amount">>((from, to) => client.schema("werkbank")
    .from("invoice_balances").select("open_amount").eq("org_id", orgId).lt("open_amount", 0)
    .order("invoice_id").range(from, to) as unknown as Page<Pick<InvoiceBalance, "open_amount">>);
  const cents = rows.reduce((sum, r) => sum + Math.round(-(r.open_amount ?? 0) * 100), 0);
  return cents / 100;
}

/** Books a payment, refund or write-off; returns the entry id. The database checks everything. */
export async function recordInvoiceEntry(
  client: Client,
  input: { invoiceId: string; kind: EntryKind; amount: number; bookedOn: string; note?: string; writeOffReason?: WriteOffReason },
): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("record_invoice_entry", {
    p_invoice: input.invoiceId,
    p_kind: input.kind,
    p_amount: input.amount,
    p_booked_on: input.bookedOn,
    p_note: input.note,
    p_write_off_reason: input.writeOffReason,
  });
  if (error) throw error;
  return data as string;
}

/** Reverses an entry (the ledger is append-only: the entry stays, marked reversed). */
export async function reverseInvoiceEntry(client: Client, entryId: string, reason: string): Promise<void> {
  const { error } = await client.schema("werkbank").rpc("reverse_invoice_entry", { p_entry: entryId, p_reason: reason });
  if (error) throw error;
}

/** Moves a payment to another invoice of the same customer; returns the new entry id. */
export async function transferInvoiceEntry(client: Client, entryId: string, targetInvoiceId: string, reason: string): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("transfer_invoice_entry", {
    p_entry: entryId, p_target_invoice: targetInvoiceId, p_reason: reason,
  });
  if (error) throw error;
  return data;
}

/** Issued invoices of the customer a payment may move to, newest first so a corrected copy leads. */
export async function fetchTransferTargets(client: Client, orgId: string, customerId: string, excludeInvoiceId: string): Promise<InvoiceListRow[]> {
  return fetchAllPages<InvoiceListRow>((from, to) => client.schema("werkbank").from("invoice_list").select("*")
    .eq("org_id", orgId).eq("customer_id", customerId).eq("status", "issued").neq("id", excludeInvoiceId)
    .order("issue_date", { ascending: false }).order("id").range(from, to) as unknown as Page<InvoiceListRow>);
}
