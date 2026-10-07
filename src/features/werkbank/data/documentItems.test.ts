import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { addItem, deleteItem, fetchItems, refKey, reorderItems, updateItem, type ItemDraft } from "./documentItems";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const T = "werkbank.document_items";
const draft: ItemDraft = {
  kind: "item", name: "Heizkörper", description: null, catalog_item_id: null, item_no: "A-1",
  quantity: 2, unit_code: "H87", labour_price: 10, material_price: 5, vat_rate: 19,
};

describe("refKey", () => {
  it("distinguishes quote and order", () => {
    expect(refKey({ quoteId: "q1" })).toBe("quote_id:q1");
    expect(refKey({ orderId: "o1" })).toBe("order_id:o1");
  });
});

describe("fetchItems", () => {
  it("reads the items of a quote in sort order", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ id: "i1" }], error: null } });
    expect(await fetchItems(asClient(fake), { quoteId: "q1" })).toEqual([{ id: "i1" }]);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["quote_id", "q1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "order", args: ["sort_order"] }));
  });
  it("reads the items of an order", async () => {
    const fake = createFakeSupabase({ [T]: { data: [], error: null } });
    await fetchItems(asClient(fake), { orderId: "o1" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["order_id", "o1"] }));
  });
  it("rejects on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(fetchItems(asClient(fake), { quoteId: "q1" })).rejects.toThrow("boom");
  });
});

describe("addItem", () => {
  it("inserts with org, parent and sort order", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "i1" }, error: null } });
    await addItem(asClient(fake), "org-1", { quoteId: "q1" }, draft, 30);
    expect(fake.calls).toContainEqual(
      expect.objectContaining({ method: "insert", args: [{ ...draft, org_id: "org-1", quote_id: "q1", sort_order: 30 }] }),
    );
  });
  it("uses order_id for an order", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "i1" }, error: null } });
    await addItem(asClient(fake), "org-1", { orderId: "o1" }, draft, 0);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "insert", args: [expect.objectContaining({ order_id: "o1" })] }));
  });
});

describe("updateItem and deleteItem", () => {
  it("updates by id", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await updateItem(asClient(fake), "i1", { quantity: 3 });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "update", args: [{ quantity: 3 }] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "i1"] }));
  });
  it("deletes by id and rejects on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: new Error("locked") } });
    await expect(deleteItem(asClient(fake), "i1")).rejects.toThrow("locked");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "delete" }));
  });
});

describe("reorderItems", () => {
  it("writes sort_order 0, 10, 20 in the given order", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await reorderItems(asClient(fake), { quoteId: "q1" }, ["a", "b", "c"]);
    const updates = fake.calls.filter((c) => c.method === "update").map((c) => c.args[0]);
    expect(updates).toEqual([{ sort_order: 0 }, { sort_order: 10 }, { sort_order: 20 }]);
    const ids = fake.calls.filter((c) => c.method === "eq" && c.args[0] === "id").map((c) => c.args[1]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
  it("rejects when one update fails", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: new Error("locked") } });
    await expect(reorderItems(asClient(fake), { quoteId: "q1" }, ["a"])).rejects.toThrow("locked");
  });
});
