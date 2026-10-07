import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchStartCounts } from "./startList";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;

describe("fetchStartCounts", () => {
  it("returns the head counts of technicians, catalog items and customers", async () => {
    const fake = createFakeSupabase({
      artists: { data: null, error: null, count: 3 },
      "werkbank.catalog_items": { data: null, error: null, count: 12 },
      "werkbank.customers": { data: null, error: null, count: 0 },
    });
    await expect(fetchStartCounts(asClient(fake), "org-1")).resolves.toEqual({
      technicians: 3,
      catalogItems: 12,
      customers: 0,
    });
    expect(fake.calls).toContainEqual(
      expect.objectContaining({ table: "artists", method: "select", args: ["id", { count: "exact", head: true }] }),
    );
  });

  it("scopes every count to the org and leaves archived werkbank rows out", async () => {
    const fake = createFakeSupabase({});
    await fetchStartCounts(asClient(fake), "org-1");
    for (const table of ["artists", "werkbank.catalog_items", "werkbank.customers"]) {
      expect(fake.calls).toContainEqual(expect.objectContaining({ table, method: "eq", args: ["org_id", "org-1"] }));
    }
    for (const table of ["werkbank.catalog_items", "werkbank.customers"]) {
      expect(fake.calls).toContainEqual(expect.objectContaining({ table, method: "is", args: ["archived_at", null] }));
    }
    expect(fake.calls.filter((c) => c.table === "artists" && c.method === "is")).toEqual([]);
  });

  it("treats a missing count as zero and throws on an error", async () => {
    const empty = createFakeSupabase({});
    await expect(fetchStartCounts(asClient(empty), "org-1")).resolves.toEqual({ technicians: 0, catalogItems: 0, customers: 0 });
    const failing = createFakeSupabase({ "werkbank.customers": { data: null, error: new Error("boom") } });
    await expect(fetchStartCounts(asClient(failing), "org-1")).rejects.toThrow("boom");
  });
});
