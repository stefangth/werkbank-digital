import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";

export type DocumentItem = Database["werkbank"]["Tables"]["document_items"]["Row"];
export type ItemDraft = Pick<
  DocumentItem,
  "kind" | "name" | "description" | "catalog_item_id" | "item_no" | "quantity" | "unit_code" | "labour_price" | "material_price" | "vat_rate"
>;
export type DocumentRef = { quoteId: string } | { orderId: string };

type Client = SupabaseClient<Database>;
type ItemInsert = Database["werkbank"]["Tables"]["document_items"]["Insert"];

/** The parent column and id of a document reference. */
function refColumn(ref: DocumentRef): { column: "quote_id" | "order_id"; id: string } {
  return "quoteId" in ref ? { column: "quote_id", id: ref.quoteId } : { column: "order_id", id: ref.orderId };
}

/** Stable query-key part for a reference. */
export function refKey(ref: DocumentRef): string {
  const { column, id } = refColumn(ref);
  return `${column}:${id}`;
}

/** The items of one quote or order in display order. A document id belongs to one org, so the
 *  parent id scopes the read (a literal `.eq("quote_id"|"order_id", ...)`: src/test/orgScoping.test.ts
 *  scans for it). */
export async function fetchItems(client: Client, ref: DocumentRef): Promise<DocumentItem[]> {
  type Page = PromiseLike<{ data: DocumentItem[] | null; error: unknown }>;
  return fetchAllPages<DocumentItem>((from, to) =>
    ("quoteId" in ref
      ? client.schema("werkbank").from("document_items").select("*").eq("quote_id", ref.quoteId).order("sort_order").order("id").range(from, to)
      : client.schema("werkbank").from("document_items").select("*").eq("order_id", ref.orderId).order("sort_order").order("id").range(from, to)) as unknown as Page,
  );
}

export async function addItem(client: Client, orgId: string, ref: DocumentRef, draft: ItemDraft, sortOrder: number): Promise<DocumentItem> {
  const row: ItemInsert = {
    ...draft,
    org_id: orgId,
    sort_order: sortOrder,
    ...("quoteId" in ref ? { quote_id: ref.quoteId } : { order_id: ref.orderId }),
  };
  const { data, error } = await client.schema("werkbank").from("document_items")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateItem(client: Client, id: string, patch: Partial<ItemDraft>): Promise<void> {
  const { error } = await client.schema("werkbank").from("document_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteItem(client: Client, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("document_items").delete().eq("id", id);
  if (error) throw error;
}

/** Writes `sort_order = index * 10` for the ids in the given order. `ref` scopes each update to
 *  its document, so a stray id cannot move an item of another one. */
export async function reorderItems(client: Client, ref: DocumentRef, ids: string[]): Promise<void> {
  const { column, id: parent } = refColumn(ref);
  const results = await Promise.all(
    ids.map((id, index) =>
      client.schema("werkbank").from("document_items").update({ sort_order: index * 10 }).eq("id", id).eq(column, parent),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}
