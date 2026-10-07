import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface StartCounts {
  technicians: number;
  catalogItems: number;
  customers: number;
}

const HEAD_COUNT = { count: "exact", head: true } as const;

/** Row counts behind the dashboard start list. Technicians are the org's artists rows;
 *  archived catalog items and customers do not count as "set up". */
export async function fetchStartCounts(client: SupabaseClient<Database>, orgId: string): Promise<StartCounts> {
  const [technicians, catalogItems, customers] = await Promise.all([
    client.from("artists").select("id", HEAD_COUNT).eq("org_id", orgId),
    client.schema("werkbank").from("catalog_items").select("id", HEAD_COUNT).eq("org_id", orgId).is("archived_at", null),
    client.schema("werkbank").from("customers").select("id", HEAD_COUNT).eq("org_id", orgId).is("archived_at", null),
  ]);
  for (const r of [technicians, catalogItems, customers]) if (r.error) throw r.error;
  return {
    technicians: technicians.count ?? 0,
    catalogItems: catalogItems.count ?? 0,
    customers: customers.count ?? 0,
  };
}
