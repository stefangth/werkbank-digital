import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import type { CompanyProfile } from "./companyProfile";
import type { DocumentTotals } from "./quotes";

export type Invoice = Database["werkbank"]["Tables"]["invoices"]["Row"];
export type InvoiceListRow = Database["werkbank"]["Views"]["invoice_list"]["Row"];
export type InvoiceWithTotals = Invoice & { totals: DocumentTotals | null };
export type InvoiceFilter = "all" | "draft" | "issued" | "cancelled";

export type InvoiceListQuery = { filter: InvoiceFilter; search: string; customerId?: string; propertyId?: string };

/** The columns a user edits on a draft; number, status, snapshots and the send stamps are service-only. */
export type InvoicePatch = Partial<Pick<Invoice,
  "customer_id" | "contact_id" | "property_id" | "location_note" | "subject" | "discount_percent" | "intro_text" | "closing_text"
  | "payment_terms_text" | "payment_due_days" | "service_date_from" | "service_date_to"
>>;

/** What a new free invoice takes from the company profile. */
export type InvoiceDefaults = Pick<CompanyProfile, "invoice_intro" | "invoice_closing" | "payment_terms_text" | "payment_due_days">;

type Client = SupabaseClient<Database>;

/** Keeps a search term from breaking out of the PostgREST `or(...)` filter. */
function safeTerm(term: string): string {
  return term.replace(/[,()%*\\]/g, " ").trim();
}

/** Invoices of the org (with customer, property and totals), newest first, optionally narrowed. */
export async function fetchInvoices(client: Client, orgId: string, query: InvoiceListQuery): Promise<InvoiceListRow[]> {
  const term = safeTerm(query.search);
  return fetchAllPages<InvoiceListRow>((from, to) => {
    let q = client.schema("werkbank").from("invoice_list").select("*").eq("org_id", orgId);
    if (query.filter !== "all") q = q.eq("status", query.filter);
    if (query.customerId) q = q.eq("customer_id", query.customerId);
    if (query.propertyId) q = q.eq("property_id", query.propertyId);
    if (term) {
      const p = `%${term}%`;
      q = q.or(`invoice_no.ilike.${p},customer_name.ilike.${p},property_name.ilike.${p},subject.ilike.${p}`);
    }
    return q.order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: InvoiceListRow[] | null; error: unknown }>;
  });
}

/** One invoice with its totals (null while it has no items), or null if missing. */
export async function fetchInvoice(client: Client, orgId: string, id: string): Promise<InvoiceWithTotals | null> {
  const werkbank = client.schema("werkbank");
  const [invoice, totals] = await Promise.all([
    werkbank.from("invoices").select("*").eq("org_id", orgId).eq("id", id).maybeSingle(),
    werkbank.from("document_totals").select("*").eq("invoice_id", id).maybeSingle(),
  ]);
  if (invoice.error) throw invoice.error;
  if (totals.error) throw totals.error;
  return invoice.data ? { ...invoice.data, totals: totals.data } : null;
}

/** The live (not cancelled) invoice of an order, if any. */
export async function fetchActiveInvoiceForOrder(client: Client, orgId: string, orderId: string): Promise<{ id: string; invoice_no: string | null } | null> {
  const { data, error } = await client.schema("werkbank").from("invoices").select("id, invoice_no")
    .eq("org_id", orgId).eq("order_id", orderId).eq("type", "invoice").neq("status", "cancelled").maybeSingle();
  if (error) throw error;
  return data;
}

/** The cancellation document that cancels this invoice, if any (at most one exists). */
export async function fetchCancellationOf(client: Client, orgId: string, invoiceId: string): Promise<{ id: string; invoice_no: string | null } | null> {
  const { data, error } = await client.schema("werkbank").from("invoices").select("id, invoice_no")
    .eq("org_id", orgId).eq("cancels_invoice_id", invoiceId).eq("type", "cancellation").maybeSingle();
  if (error) throw error;
  return data;
}

/** Creates a free (order-less) draft, prefilled from the company profile. The database assigns no number yet. */
export async function createFreeInvoice(
  client: Client,
  orgId: string,
  args: { customerId: string; propertyId?: string | null; profile: InvoiceDefaults | null },
): Promise<string> {
  const { customerId, propertyId, profile } = args;
  const { data, error } = await client.schema("werkbank").from("invoices")
    .insert({
      org_id: orgId,
      customer_id: customerId,
      property_id: propertyId ?? null,
      intro_text: profile?.invoice_intro ?? null,
      closing_text: profile?.invoice_closing ?? null,
      payment_terms_text: profile?.payment_terms_text ?? null,
      ...(profile ? { payment_due_days: profile.payment_due_days } : {}),
    }) // invoice_no, status, type, snapshots: assigned by the database
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateInvoice(client: Client, orgId: string, id: string, patch: InvoicePatch): Promise<void> {
  const { error } = await client.schema("werkbank").from("invoices").update(patch).eq("org_id", orgId).eq("id", id);
  if (error) throw error;
}

export async function deleteInvoice(client: Client, orgId: string, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("invoices").delete().eq("org_id", orgId).eq("id", id);
  if (error) throw error;
}

/** Creates the draft invoice for a done order and returns its id. */
export async function createInvoiceFromOrder(client: Client, orderId: string): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("create_invoice_from_order", { p_order: orderId });
  if (error) throw error;
  return data;
}

/** Cancels an issued invoice by a cancellation document and returns that document's id. */
export async function cancelInvoice(client: Client, id: string): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("cancel_invoice", { p_invoice: id });
  if (error) throw error;
  return data;
}

/** Copies an invoice as a new draft and returns its id. */
export async function copyInvoice(client: Client, id: string): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("copy_invoice", { p_invoice: id });
  if (error) throw error;
  return data;
}
