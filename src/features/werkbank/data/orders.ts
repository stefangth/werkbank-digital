import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import type { DocumentTotals } from "./quotes";

export type Order = Database["werkbank"]["Tables"]["orders"]["Row"];
export type OrderListRow = Database["werkbank"]["Views"]["order_list"]["Row"];
export type OrderWithTotals = Order & { totals: DocumentTotals | null; technician_ids: string[] };

/** The fields a user fills in; order_no, quote_id and the status stamps are service-only. */
export type OrderDraft = {
  customer_id: string;
  property_id?: string | null;
  contact_id?: string | null;
  location_note?: string | null;
  subject?: string | null;
  discount_percent?: number;
  notes?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
};
export type OrderPatch = Partial<OrderDraft>;

type Client = SupabaseClient<Database>;
type OrderInsert = Database["werkbank"]["Tables"]["orders"]["Insert"];

/** All orders of the org with customer, property, totals and technicians, newest first. */
export async function fetchOrderList(client: Client, orgId: string): Promise<OrderListRow[]> {
  return fetchAllPages<OrderListRow>((from, to) =>
    client.schema("werkbank").from("order_list").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: OrderListRow[] | null; error: unknown }>,
  );
}

/** One order with its totals and technician ids, or null if missing. */
export async function fetchOrder(client: Client, id: string): Promise<OrderWithTotals | null> {
  const werkbank = client.schema("werkbank");
  const [order, totals, techs] = await Promise.all([
    werkbank.from("orders").select("*").eq("id", id).maybeSingle(),
    werkbank.from("document_totals").select("*").eq("order_id", id).maybeSingle(),
    werkbank.from("order_technicians").select("artist_id").eq("order_id", id),
  ]);
  if (order.error) throw order.error;
  if (totals.error) throw totals.error;
  if (techs.error) throw techs.error;
  return order.data
    ? { ...order.data, totals: totals.data, technician_ids: (techs.data ?? []).map((r) => r.artist_id) }
    : null;
}

/** Creates an open order without a quote. The database assigns `order_no`. */
export async function createOrder(client: Client, orgId: string, draft: OrderDraft): Promise<string> {
  const { data, error } = await client.schema("werkbank").from("orders")
    .insert({ ...draft, org_id: orgId } as OrderInsert) // order_no, status: assigned by the database
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateOrder(client: Client, id: string, patch: OrderPatch): Promise<void> {
  const { error } = await client.schema("werkbank").from("orders").update(patch).eq("id", id);
  if (error) throw error;
}

/** Only the status is written; `completed_at` and `cancelled_at` are stamped by the trigger. */
export async function setOrderStatus(client: Client, id: string, status: Order["status"]): Promise<void> {
  await updateOrder(client, id, { status } as OrderPatch);
}

/** Makes the technician set equal `artistIds`: deletes the missing, inserts the new. */
export async function setOrderTechnicians(client: Client, orgId: string, orderId: string, artistIds: string[]): Promise<void> {
  const werkbank = client.schema("werkbank");
  const { data, error } = await werkbank.from("order_technicians").select("artist_id").eq("org_id", orgId).eq("order_id", orderId);
  if (error) throw error;
  const current = new Set((data ?? []).map((r) => r.artist_id));
  const wanted = new Set(artistIds);
  const toDelete = [...current].filter((id) => !wanted.has(id));
  const toInsert = [...wanted].filter((id) => !current.has(id));
  if (toDelete.length) {
    const res = await werkbank.from("order_technicians").delete().eq("org_id", orgId).eq("order_id", orderId).in("artist_id", toDelete);
    if (res.error) throw res.error;
  }
  if (toInsert.length) {
    const res = await werkbank.from("order_technicians").insert(toInsert.map((artist_id) => ({ org_id: orgId, order_id: orderId, artist_id })));
    if (res.error) throw res.error;
  }
}

/** Creates the order of an accepted quote and returns its id. */
export async function createOrderFromQuote(client: Client, quoteId: string): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("create_order_from_quote", { p_quote: quoteId });
  if (error) throw error;
  return data;
}

/** The id of the order made from a quote, or null while there is none. */
export async function fetchOrderIdForQuote(client: Client, quoteId: string): Promise<string | null> {
  const { data, error } = await client.schema("werkbank").from("orders").select("id").eq("quote_id", quoteId).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
