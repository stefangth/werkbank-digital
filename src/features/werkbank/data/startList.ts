import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isCompanyProfileComplete } from "../lib/quotePreflight";
import { fetchCompanyProfile } from "./companyProfile";

export interface StartCounts {
  technicians: number;
  catalogItems: number;
  customers: number;
  /** Invoices that left draft (issued or cancelled). */
  invoices: number;
  /** The company profile carries what a quote needs (name, address, email, tax number or VAT id). */
  companyComplete: boolean;
}

const HEAD_COUNT = { count: "exact", head: true } as const;

/** Row counts and the company-profile check behind the dashboard start list. Technicians are the org's artists rows;
 *  archived catalog items and customers do not count as "set up". */
export async function fetchStartCounts(client: SupabaseClient<Database>, orgId: string): Promise<StartCounts> {
  const [technicians, catalogItems, customers, invoices, profile] = await Promise.all([
    client.from("artists").select("id", HEAD_COUNT).eq("org_id", orgId),
    client.schema("werkbank").from("catalog_items").select("id", HEAD_COUNT).eq("org_id", orgId).is("archived_at", null),
    client.schema("werkbank").from("customers").select("id", HEAD_COUNT).eq("org_id", orgId).is("archived_at", null),
    client.schema("werkbank").from("invoices").select("id", HEAD_COUNT).eq("org_id", orgId).neq("status", "draft"),
    fetchCompanyProfile(client, orgId),
  ]);
  for (const r of [technicians, catalogItems, customers, invoices]) if (r.error) throw r.error;
  return {
    technicians: technicians.count ?? 0,
    catalogItems: catalogItems.count ?? 0,
    customers: customers.count ?? 0,
    invoices: invoices.count ?? 0,
    companyComplete: isCompanyProfileComplete(profile),
  };
}
