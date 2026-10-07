import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import { toPropertyRow, type PropertyForm } from "../schemas/property";
import type { Customer } from "./customers";

export type Property = Database["werkbank"]["Tables"]["properties"]["Row"];
export type PropertyListRow = Property & {
  customer: Pick<Customer, "id" | "kind" | "company_name" | "first_name" | "last_name" | "archived_at">;
};

type PropertyInsert = Database["werkbank"]["Tables"]["properties"]["Insert"];
type Client = SupabaseClient<Database>;
type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

const WITH_CUSTOMER = "*, customer:customers(id, kind, company_name, first_name, last_name, archived_at)";

/** All properties of the org (archived ones included) with their customer, ordered by name.
 *  The `.from(...)` and the `org_id` filter stay in one statement: src/test/orgScoping.test.ts scans for it. */
export async function fetchProperties(client: Client, orgId: string): Promise<PropertyListRow[]> {
  return fetchAllPages<PropertyListRow>((from, to) =>
    client.schema("werkbank").from("properties").select(WITH_CUSTOMER).eq("org_id", orgId).order("name").order("id").range(from, to) as unknown as Page<PropertyListRow>,
  );
}

export async function fetchProperty(client: Client, id: string): Promise<PropertyListRow | null> {
  const { data, error } = await client.schema("werkbank").from("properties").select(WITH_CUSTOMER).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as PropertyListRow | null;
}

/** The properties of one customer (archived ones included), ordered by name. */
export async function fetchPropertiesForCustomer(client: Client, customerId: string): Promise<Property[]> {
  return fetchAllPages<Property>((from, to) =>
    client.schema("werkbank").from("properties").select("*").eq("customer_id", customerId).order("name").order("id").range(from, to) as unknown as Page<Property>,
  );
}

export async function createProperty(client: Client, orgId: string, form: PropertyForm): Promise<Property> {
  const { data, error } = await client.schema("werkbank").from("properties")
    .insert({ ...toPropertyRow(form), org_id: orgId } as PropertyInsert)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProperty(client: Client, id: string, form: PropertyForm): Promise<void> {
  const { error } = await client.schema("werkbank").from("properties").update(toPropertyRow(form)).eq("id", id);
  if (error) throw error;
}

/** Archives with the current time, or restores with `null`. */
export async function setPropertyArchived(client: Client, id: string, archived: boolean): Promise<void> {
  const { error } = await client.schema("werkbank").from("properties")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteProperty(client: Client, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("properties").delete().eq("id", id);
  if (error) throw error;
}
