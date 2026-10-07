import type { Json } from "@/integrations/supabase/types";
import { CATALOG_IMPORT, CUSTOMER_IMPORT, PROPERTY_IMPORT, type PropertyImportForm } from "../import/specs";
import type { ImportClient, ImportResult, ImportSpec } from "../import/types";
import type { CatalogItemForm } from "../schemas/catalogItem";
import type { CustomerForm } from "../schemas/customer";

type RpcName = "import_customers" | "import_properties" | "import_catalog_items";

/** Sends the rows to one werkbank import RPC; the results line up with the rows by `row` index. */
async function runImport(
  client: ImportClient,
  fn: RpcName,
  orgId: string,
  rows: Record<string, unknown>[],
): Promise<ImportResult[]> {
  const { data, error } = await client.schema("werkbank").rpc(fn, { p_org: orgId, p_rows: rows as Json });
  if (error) throw error;
  return (data ?? []) as unknown as ImportResult[];
}

export const importCustomers = (client: ImportClient, orgId: string, rows: Record<string, unknown>[]) =>
  runImport(client, "import_customers", orgId, rows);

export const importProperties = (client: ImportClient, orgId: string, rows: Record<string, unknown>[]) =>
  runImport(client, "import_properties", orgId, rows);

export const importCatalogItems = (client: ImportClient, orgId: string, rows: Record<string, unknown>[]) =>
  runImport(client, "import_catalog_items", orgId, rows);

// The specs in import/specs.ts stay pure (no RPC); the full specs the pages hand to ImportDialog are composed here.
export const CUSTOMER_IMPORT_SPEC: ImportSpec<CustomerForm> = { ...CUSTOMER_IMPORT, run: importCustomers };
export const PROPERTY_IMPORT_SPEC: ImportSpec<PropertyImportForm> = { ...PROPERTY_IMPORT, run: importProperties };
export const CATALOG_IMPORT_SPEC: ImportSpec<CatalogItemForm> = { ...CATALOG_IMPORT, run: importCatalogItems };
