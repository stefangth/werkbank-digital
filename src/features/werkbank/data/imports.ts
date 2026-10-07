import type { Json } from "@/integrations/supabase/types";
import { CATALOG_IMPORT, CUSTOMER_IMPORT, PROPERTY_IMPORT, type PropertyImportForm } from "../import/specs";
import type { ImportClient, ImportResult, ImportSpec } from "../import/types";
import type { CatalogItemForm } from "../schemas/catalogItem";
import type { CustomerForm } from "../schemas/customer";

type RpcName = "import_customers" | "import_properties" | "import_catalog_items";

/** Rows per RPC call. One call for a full 5000-row file runs past the 8 s statement timeout; 500 rows
 *  take well under a second each. The chunks run one after another, each in its own transaction. */
export const IMPORT_CHUNK_SIZE = 500;

/** Sends the rows to one werkbank import RPC in chunks, in the order `order` gives (indexes into `rows`,
 *  default: as given). The results are mapped back to indexes into `rows` and returned sorted by `row`. */
async function runImport(
  client: ImportClient,
  fn: RpcName,
  orgId: string,
  rows: Record<string, unknown>[],
  order: number[] = rows.map((_, i) => i),
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (let start = 0; start < order.length; start += IMPORT_CHUNK_SIZE) {
    const sent = order.slice(start, start + IMPORT_CHUNK_SIZE);
    const { data, error } = await client.schema("werkbank").rpc(fn, { p_org: orgId, p_rows: sent.map((i) => rows[i]) as Json });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error(`werkbank.${fn} did not return a result list`);
    for (const result of data as unknown as ImportResult[]) results.push({ ...result, row: sent[result.row] });
  }
  return results.sort((a, b) => a.row - b.row);
}

/** Customers with a number go first (in file order), so a numberless row in an earlier chunk can never
 *  take a number that a later chunk brings explicitly; within one call import_customers already
 *  guards against that (Ruling R4). */
function numberedFirst(rows: Record<string, unknown>[]): number[] {
  const hasNo = (row: Record<string, unknown>) => typeof row.customer_no === "string" && row.customer_no.trim() !== "";
  const indexes = rows.map((_, i) => i);
  return [...indexes.filter((i) => hasNo(rows[i])), ...indexes.filter((i) => !hasNo(rows[i]))];
}

export const importCustomers = (client: ImportClient, orgId: string, rows: Record<string, unknown>[]) =>
  runImport(client, "import_customers", orgId, rows, numberedFirst(rows));

export const importProperties = (client: ImportClient, orgId: string, rows: Record<string, unknown>[]) =>
  runImport(client, "import_properties", orgId, rows);

export const importCatalogItems = (client: ImportClient, orgId: string, rows: Record<string, unknown>[]) =>
  runImport(client, "import_catalog_items", orgId, rows);

// The specs in import/specs.ts stay pure (no RPC); the full specs the pages hand to ImportDialog are composed here.
export const CUSTOMER_IMPORT_SPEC: ImportSpec<CustomerForm> = { ...CUSTOMER_IMPORT, run: importCustomers };
export const PROPERTY_IMPORT_SPEC: ImportSpec<PropertyImportForm> = { ...PROPERTY_IMPORT, run: importProperties };
export const CATALOG_IMPORT_SPEC: ImportSpec<CatalogItemForm> = { ...CATALOG_IMPORT, run: importCatalogItems };
