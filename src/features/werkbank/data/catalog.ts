import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import { toCatalogItemRow, type CatalogItemForm } from "../schemas/catalogItem";

export type CatalogItem = Database["werkbank"]["Tables"]["catalog_items"]["Row"];

type Client = SupabaseClient<Database>;

const items = (client: Client) => client.schema("werkbank").from("catalog_items");

/** All catalog items of the org (archived ones included), ordered by name. */
export function fetchCatalogItems(client: Client, orgId: string): Promise<CatalogItem[]> {
  return fetchAllPages<CatalogItem>((from, to) =>
    items(client).select("*").eq("org_id", orgId).order("name").order("id").range(from, to),
  );
}

export async function createCatalogItem(client: Client, orgId: string, form: CatalogItemForm): Promise<void> {
  const { error } = await items(client).insert({ ...toCatalogItemRow(form), org_id: orgId });
  if (error) throw error;
}

export async function updateCatalogItem(client: Client, id: string, form: CatalogItemForm): Promise<void> {
  const { error } = await items(client).update(toCatalogItemRow(form)).eq("id", id);
  if (error) throw error;
}

/** Archives with the current time, or restores with `null`. */
export async function setCatalogItemArchived(client: Client, id: string, archived: boolean): Promise<void> {
  const { error } = await items(client)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCatalogItem(client: Client, id: string): Promise<void> {
  const { error } = await items(client).delete().eq("id", id);
  if (error) throw error;
}
