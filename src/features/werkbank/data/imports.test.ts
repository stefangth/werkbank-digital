import { describe, it, expect, vi } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { ImportClient, ImportResult } from "../import/types";
import {
  CATALOG_IMPORT_SPEC,
  CUSTOMER_IMPORT_SPEC,
  ImportPartialError,
  PROPERTY_IMPORT_SPEC,
  importCatalogItems,
  importCustomers,
  importProperties,
} from "./imports";

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

/** A client whose import RPC answers every chunk with one "created" result per row sent. */
function chunkClient() {
  const rpc = vi.fn(async (_fn: string, params: { p_rows: Record<string, unknown>[] }) => ({
    data: params.p_rows.map((_, row) => ({ row, status: "created", reason: null, detail: null })),
    error: null,
  }));
  return { client: { schema: () => ({ rpc }) } as unknown as ImportClient, rpc };
}

describe("chunked import", () => {
  it("sends 1200 rows in three calls of 500, 500 and 200 and maps each result back to its row", async () => {
    const { client, rpc } = chunkClient();
    const many = Array.from({ length: 1200 }, (_, i) => ({ name: `Item ${i}` }));
    const out = await importCatalogItems(client, "org-1", many);
    expect(rpc.mock.calls.map(([, params]) => params.p_rows.length)).toEqual([500, 500, 200]);
    expect(rpc.mock.calls[1][1].p_rows[0]).toEqual({ name: "Item 500" });
    expect(out).toHaveLength(1200);
    expect(out.map((r) => r.row)).toEqual(many.map((_, i) => i));
  });

  it("keeps the offset of a later chunk in skipped and error results", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, row) => ({ row, status: "created", reason: null, detail: null })), error: null })
      .mockResolvedValueOnce({ data: [{ row: 3, status: "skipped", reason: "item_no_taken", detail: null }], error: null });
    const client = { schema: () => ({ rpc }) } as unknown as ImportClient;
    const out = await importCatalogItems(client, "org-1", Array.from({ length: 510 }, (_, i) => ({ name: `Item ${i}` })));
    expect(out.find((r) => r.status === "skipped")?.row).toBe(503);
  });

  it("sends customers with a number before numberless ones and reports results in file order", async () => {
    const { client, rpc } = chunkClient();
    const many: Record<string, unknown>[] = Array.from({ length: 600 }, (_, i) => ({ company_name: `Firma ${i}` }));
    many[550] = { company_name: "Alt", customer_no: "K-20000" };
    const out = await importCustomers(client, "org-1", many);
    expect(rpc.mock.calls[0][1].p_rows[0]).toEqual({ company_name: "Alt", customer_no: "K-20000" });
    expect(rpc.mock.calls[0][1].p_rows[1]).toEqual({ company_name: "Firma 0" });
    expect(out.map((r) => r.row)).toEqual(many.map((_, i) => i));
  });

  it("throws when the RPC result is not a list", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.import_customers": { data: { oops: true }, error: null } });
    await expect(importCustomers(asClient(fake), "org-1", rows)).rejects.toThrow("did not return a result list");
  });
});

describe("a chunk that fails after others were committed", () => {
  const created = (n: number) => Array.from({ length: n }, (_, row) => ({ row, status: "created", reason: null, detail: null }));
  const many = Array.from({ length: 1200 }, (_, i) => ({ name: `Item ${i}` }));
  const clientFor = (rpc: ReturnType<typeof vi.fn>) => ({ schema: () => ({ rpc }) }) as unknown as ImportClient;

  it("keeps the results of the committed chunk and names the rows of the chunks not sent", async () => {
    const boom = { message: "network", code: "XX000" };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: created(500), error: null })
      .mockResolvedValueOnce({ data: null, error: boom });
    const error = await importCatalogItems(clientFor(rpc), "org-1", many).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportPartialError);
    const partial = error as ImportPartialError;
    expect(partial.results.map((r) => r.row)).toEqual(Array.from({ length: 500 }, (_, i) => i));
    expect(partial.notSentRows).toEqual(Array.from({ length: 700 }, (_, i) => i + 500));
    expect(partial.cause).toBe(boom);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("also treats a non-list answer of a later chunk as a partial failure", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: created(500), error: null })
      .mockResolvedValueOnce({ data: { oops: true }, error: null });
    const error = (await importCatalogItems(clientFor(rpc), "org-1", many).catch((e: unknown) => e)) as ImportPartialError;
    expect(error).toBeInstanceOf(ImportPartialError);
    expect(error.results).toHaveLength(500);
    expect(error.notSentRows).toHaveLength(700);
  });

  it("reports original row indexes for customers sent numbered first", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: created(500), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "x" } });
    const rowsIn: Record<string, unknown>[] = Array.from({ length: 600 }, (_, i) => ({ company_name: `Firma ${i}` }));
    rowsIn[550] = { company_name: "Alt", customer_no: "K-1" };
    const error = (await importCustomers(clientFor(rpc), "org-1", rowsIn).catch((e: unknown) => e)) as ImportPartialError;
    expect(error.results.map((r) => r.row)).toContain(550);
    expect(error.notSentRows).toHaveLength(100);
    expect(error.notSentRows).not.toContain(550);
  });

  it("throws the plain error when the first chunk fails, as nothing was committed", async () => {
    const boom = { message: "network", code: "XX000" };
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: boom });
    await expect(importCatalogItems(clientFor(rpc), "org-1", many)).rejects.toBe(boom);
    expect(rpc).toHaveBeenCalledTimes(1);
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
