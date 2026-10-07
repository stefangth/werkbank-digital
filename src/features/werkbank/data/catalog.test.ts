import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  createCatalogItem,
  deleteCatalogItem,
  fetchCatalogItems,
  setCatalogItemArchived,
  updateCatalogItem,
} from "./catalog";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;

const form = {
  item_no: "A-1",
  name: "Heizkörper",
  description: "",
  category: "Heizung",
  unit_code: "H87" as const,
  labour_price: "12,50",
  material_price: "3",
  vat_rate: "19" as const,
};

describe("fetchCatalogItems", () => {
  it("reads the org's items ordered by name", async () => {
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: [{ id: "c1" }], error: null } });
    const rows = await fetchCatalogItems(asClient(fake), "org-1");
    expect(rows).toEqual([{ id: "c1" }]);
    const calls = fake.calls.filter((c) => c.table === "werkbank.catalog_items");
    expect(calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "order", args: ["name"] }));
  });

  it("rejects on a query error", async () => {
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: new Error("boom") } });
    await expect(fetchCatalogItems(asClient(fake), "org-1")).rejects.toThrow("boom");
  });
});

describe("createCatalogItem", () => {
  it("inserts the row with org_id and numeric prices", async () => {
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: null } });
    await createCatalogItem(asClient(fake), "org-1", form);
    const insert = fake.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toEqual({
      item_no: "A-1", name: "Heizkörper", description: null, category: "Heizung",
      unit_code: "H87", labour_price: 12.5, material_price: 3, vat_rate: 19, org_id: "org-1",
    });
  });

  it("throws the database error", async () => {
    const err = { code: "23505", message: "catalog_items_item_no_unique" };
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: err } });
    await expect(createCatalogItem(asClient(fake), "org-1", form)).rejects.toBe(err);
  });
});

describe("updateCatalogItem", () => {
  it("sends blankToNull values for the item id", async () => {
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: null } });
    await updateCatalogItem(asClient(fake), "c1", form);
    const update = fake.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({ description: null, labour_price: 12.5 });
    expect(update?.args[0]).not.toHaveProperty("org_id");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "c1"] }));
  });
});

describe("setCatalogItemArchived", () => {
  it("archives with an ISO timestamp", async () => {
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: null } });
    await setCatalogItemArchived(asClient(fake), "c1", true);
    const arg = fake.calls.find((c) => c.method === "update")?.args[0] as { archived_at: string };
    expect(new Date(arg.archived_at).toISOString()).toBe(arg.archived_at);
  });

  it("restores with null", async () => {
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: null } });
    await setCatalogItemArchived(asClient(fake), "c1", false);
    expect(fake.calls.find((c) => c.method === "update")?.args[0]).toEqual({ archived_at: null });
  });
});

describe("deleteCatalogItem", () => {
  it("deletes by id and throws on error", async () => {
    const fake = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: null } });
    await deleteCatalogItem(asClient(fake), "c1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "delete" }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "c1"] }));
    const bad = createFakeSupabase({ "werkbank.catalog_items": { data: null, error: new Error("fk") } });
    await expect(deleteCatalogItem(asClient(bad), "c1")).rejects.toThrow("fk");
  });
});
