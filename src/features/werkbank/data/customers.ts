import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import { toCustomerRow, type CustomerForm } from "../schemas/customer";

export type Customer = Database["werkbank"]["Tables"]["customers"]["Row"];
export type CustomerListRow = Customer & { property_count: number };

type CustomerInsert = Database["werkbank"]["Tables"]["customers"]["Insert"];
type Client = SupabaseClient<Database>;
type CustomerWithCount = Customer & { properties: { count: number }[] | null };

/** All customers of the org (archived ones included) with their property count, ordered by
 *  customer number. The `.from(...)` and the `org_id` filter stay in one statement:
 *  src/test/orgScoping.test.ts scans for it. */
export async function fetchCustomers(client: Client, orgId: string): Promise<CustomerListRow[]> {
  const rows = await fetchAllPages<CustomerWithCount>((from, to) =>
    client.schema("werkbank").from("customers").select("*, properties(count)").eq("org_id", orgId).order("customer_no").order("id").range(from, to) as unknown as PromiseLike<{ data: CustomerWithCount[] | null; error: unknown }>,
  );
  return rows.map(({ properties, ...customer }) => ({ ...customer, property_count: properties?.[0]?.count ?? 0 }));
}

export async function fetchCustomer(client: Client, id: string): Promise<Customer | null> {
  const { data, error } = await client.schema("werkbank").from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Returns the created row, including the `customer_no` the database assigned. */
export async function createCustomer(client: Client, orgId: string, form: CustomerForm): Promise<Customer> {
  const { data, error } = await client.schema("werkbank").from("customers")
    .insert({ ...toCustomerRow(form), org_id: orgId } as CustomerInsert) // customer_no: assigned by the trigger
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(client: Client, id: string, form: CustomerForm): Promise<void> {
  const { error } = await client.schema("werkbank").from("customers").update(toCustomerRow(form)).eq("id", id);
  if (error) throw error;
}

/** Archives with the current time, or restores with `null`. */
export async function setCustomerArchived(client: Client, id: string, archived: boolean): Promise<void> {
  const { error } = await client.schema("werkbank").from("customers")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCustomer(client: Client, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("customers").delete().eq("id", id);
  if (error) throw error;
}
