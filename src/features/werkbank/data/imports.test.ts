import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { ImportClient, ImportResult } from "../import/types";
import { CATALOG_IMPORT_SPEC, CUSTOMER_IMPORT_SPEC, PROPERTY_IMPORT_SPEC, importCatalogItems, importCustomers, importProperties } from "./imports";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as ImportClient;
const results: ImportResult[] = [{ row: 0, status: "created", reason: null, detail: null }];
const rows = [{ company_name: "Muster GmbH" }];

describe.each([
  ["customers", "import_customers", importCustomers],
  ["properties", "import_properties", importProperties],
  ["catalog items", "import_catalog_items", importCatalogItems],
])("import of %s", (_name, fn, run) => {
  it(`calls ${fn} with p_org and p_rows and returns the results`, async () => {
    const fake = createFakeSupabase({ [`rpc:werkbank.${fn}`]: { data: results, error: null } });
    await expect(run(asClient(fake), "org-1", rows)).resolves.toEqual(results);
    const call = fake.calls.find((c) => c.table === `rpc:werkbank.${fn}`);
    expect(call?.args[0]).toEqual({ p_org: "org-1", p_rows: rows });
  });

  it("throws the database error", async () => {
    const error = { message: "boom", code: "XX000" };
    const fake = createFakeSupabase({ [`rpc:werkbank.${fn}`]: { data: null, error } });
    await expect(run(asClient(fake), "org-1", rows)).rejects.toBe(error);
  });
});

describe("composed specs", () => {
  it("attach the matching run to each definition", () => {
    expect(CUSTOMER_IMPORT_SPEC.entity).toBe("customers");
    expect(CUSTOMER_IMPORT_SPEC.run).toBe(importCustomers);
    expect(PROPERTY_IMPORT_SPEC.entity).toBe("properties");
    expect(PROPERTY_IMPORT_SPEC.run).toBe(importProperties);
    expect(CATALOG_IMPORT_SPEC.entity).toBe("catalog_items");
    expect(CATALOG_IMPORT_SPEC.run).toBe(importCatalogItems);
  });
});
