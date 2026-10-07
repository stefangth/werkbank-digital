import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import { toCatalogItemRow, type CatalogItemForm } from "../schemas/catalogItem";

export type CatalogItem = Database["werkbank"]["Tables"]["catalog_items"]["Row"];

type Client = SupabaseClient<Database>;

/** All catalog items of the org (archived ones included), ordered by name. The `.from(...)`
 *  and the `org_id` filter stay in one statement: src/test/orgScoping.test.ts scans for it. */
export function fetchCatalogItems(client: Client, orgId: string): Promise<CatalogItem[]> {
  return fetchAllPages<CatalogItem>((from, to) =>
    client.schema("werkbank").from("catalog_items").select("*").eq("org_id", orgId).order("name").order("id").range(from, to),
  );
}

export async function createCatalogItem(client: Client, orgId: string, form: CatalogItemForm): Promise<void> {
  const { error } = await client.schema("werkbank").from("catalog_items").insert({ ...toCatalogItemRow(form), org_id: orgId });
  if (error) throw error;
}

export async function updateCatalogItem(client: Client, id: string, form: CatalogItemForm): Promise<void> {
  const { error } = await client.schema("werkbank").from("catalog_items").update(toCatalogItemRow(form)).eq("id", id);
  if (error) throw error;
}

/** Archives with the current time, or restores with `null`. */
export async function setCatalogItemArchived(client: Client, id: string, archived: boolean): Promise<void> {
  const { error } = await client.schema("werkbank").from("catalog_items")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCatalogItem(client: Client, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("catalog_items").delete().eq("id", id);
  if (error) throw error;
}
