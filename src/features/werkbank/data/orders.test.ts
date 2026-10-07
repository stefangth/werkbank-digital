import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  createOrder, createOrderFromQuote, deleteOrder, fetchOrder, fetchOrderIdForQuote, fetchOrderList, setOrderStatus, setOrderTechnicians, updateOrder,
} from "./orders";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const O = "werkbank.orders";
const T = "werkbank.order_technicians";

describe("fetchOrderList", () => {
  it("reads the order_list view scoped to the org", async () => {
    const fake = createFakeSupabase({ "werkbank.order_list": { data: [{ id: "o1" }], error: null } });
    expect(await fetchOrderList(asClient(fake), "org-1")).toEqual([{ id: "o1" }]);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "range", args: [0, 999] }));
  });
});

describe("fetchOrder", () => {
  it("combines the row, its totals and technician ids", async () => {
    const fake = createFakeSupabase({
      [O]: { data: { id: "o1", order_no: "AU-0001" }, error: null },
      "werkbank.document_totals": { data: { order_id: "o1", gross_total: 119 }, error: null },
      [T]: { data: [{ artist_id: "a1" }, { artist_id: "a2" }], error: null },
      "werkbank.order_list": { data: { technician_names: ["Anna Berg", "Ben Roth"] }, error: null },
    });
    expect(await fetchOrder(asClient(fake), "o1")).toEqual({
      id: "o1", order_no: "AU-0001", totals: { order_id: "o1", gross_total: 119 },
      technician_ids: ["a1", "a2"], technician_names: ["Anna Berg", "Ben Roth"],
    });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.order_list", method: "eq", args: ["id", "o1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.document_totals", method: "eq", args: ["order_id", "o1"] }));
  });
  it("returns null for a missing order", async () => {
    const fake = createFakeSupabase({
      [O]: { data: null, error: null }, "werkbank.document_totals": { data: null, error: null }, [T]: { data: [], error: null },
      "werkbank.order_list": { data: null, error: null },
    });
    expect(await fetchOrder(asClient(fake), "nope")).toBeNull();
  });
  it("throws when the names cannot be read", async () => {
    const error = { code: "42501" };
    const fake = createFakeSupabase({
      [O]: { data: { id: "o1" }, error: null }, "werkbank.document_totals": { data: null, error: null }, [T]: { data: [], error: null },
      "werkbank.order_list": { data: null, error },
    });
    await expect(fetchOrder(asClient(fake), "o1")).rejects.toBe(error);
  });
});

describe("createOrder", () => {
  it("inserts the draft with the org and sends no service-only column", async () => {
    const fake = createFakeSupabase({ [O]: { data: { id: "o1" }, error: null } });
    expect(await createOrder(asClient(fake), "org-1", { customer_id: "c1", subject: "Bad" })).toBe("o1");
    const insert = fake.calls.find((c) => c.table === O && c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toEqual({ customer_id: "c1", subject: "Bad", org_id: "org-1" });
    expect(insert).not.toHaveProperty("order_no");
    expect(insert).not.toHaveProperty("quote_id");
    expect(insert).not.toHaveProperty("status");
  });
  it("throws a database error", async () => {
    const fake = createFakeSupabase({ [O]: { data: null, error: { code: "42501", message: "x" } } });
    await expect(createOrder(asClient(fake), "org-1", { customer_id: "c1" })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("updateOrder and setOrderStatus", () => {
  it("updates the patch by id", async () => {
    const fake = createFakeSupabase({ [O]: { data: null, error: null } });
    await updateOrder(asClient(fake), "o1", { notes: "n" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: O, method: "update", args: [{ notes: "n" }] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: O, method: "eq", args: ["id", "o1"] }));
  });
  it("writes only the status, never a stamp column", async () => {
    const fake = createFakeSupabase({ [O]: { data: null, error: null } });
    await setOrderStatus(asClient(fake), "o1", "in_progress");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: O, method: "update", args: [{ status: "in_progress" }] }));
  });
  it("throws a database error", async () => {
    const fake = createFakeSupabase({ [O]: { data: null, error: { code: "22023", message: "invalid_transition" } } });
    await expect(setOrderStatus(asClient(fake), "o1", "done")).rejects.toMatchObject({ code: "22023" });
  });
});

describe("setOrderTechnicians", () => {
  it("from [a,b] to [b,c] deletes a and inserts c only", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ artist_id: "a" }, { artist_id: "b" }], error: null } });
    await setOrderTechnicians(asClient(fake), "org-1", "o1", ["b", "c"]);
    const del = fake.calls.find((c) => c.table === T && c.method === "delete");
    expect(del).toBeTruthy();
    const afterDelete = fake.calls.slice(fake.calls.indexOf(del!));
    expect(afterDelete).toContainEqual(expect.objectContaining({ table: T, method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: T, method: "in", args: ["artist_id", ["a"]] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({
      table: T, method: "upsert",
      args: [[{ org_id: "org-1", order_id: "o1", artist_id: "c" }], { onConflict: "order_id,artist_id", ignoreDuplicates: true }],
    }));
  });
  it("inserts before it deletes, so a failed delete leaves a superset", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ artist_id: "a" }], error: null } });
    await setOrderTechnicians(asClient(fake), "org-1", "o1", ["b"]);
    const upsertAt = fake.calls.findIndex((c) => c.table === T && c.method === "upsert");
    const deleteAt = fake.calls.findIndex((c) => c.table === T && c.method === "delete");
    expect(upsertAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(upsertAt);
  });
  it("ignores a technician another save inserted meanwhile (no unique violation)", async () => {
    // The read sees none, a concurrent save adds "a"; the upsert must not fail on the duplicate.
    const fake = createFakeSupabase({ [T]: { data: [], error: null } });
    await setOrderTechnicians(asClient(fake), "org-1", "o1", ["a"]);
    const upsert = fake.calls.find((c) => c.table === T && c.method === "upsert")!;
    expect(upsert.args[1]).toEqual({ onConflict: "order_id,artist_id", ignoreDuplicates: true });
    expect(fake.calls.some((c) => c.table === T && c.method === "insert")).toBe(false);
  });
  it("does nothing when the set is unchanged", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ artist_id: "a" }], error: null } });
    await setOrderTechnicians(asClient(fake), "org-1", "o1", ["a"]);
    expect(fake.calls.some((c) => c.method === "delete" || c.method === "insert" || c.method === "upsert")).toBe(false);
  });
});

describe("deleteOrder", () => {
  it("deletes by id", async () => {
    const fake = createFakeSupabase({ [O]: { data: [{ id: "o1" }], error: null } });
    await deleteOrder(asClient(fake), "o1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: O, method: "delete" }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: O, method: "eq", args: ["id", "o1"] }));
  });
  it("rejects when RLS filtered the row (the order is no longer open)", async () => {
    const fake = createFakeSupabase({ [O]: { data: [], error: null } });
    await expect(deleteOrder(asClient(fake), "o1")).rejects.toEqual({ code: "P0001", message: "invalid_transition" });
  });
  it("rejects on a database error", async () => {
    const fake = createFakeSupabase({ [O]: { data: null, error: new Error("boom") } });
    await expect(deleteOrder(asClient(fake), "o1")).rejects.toThrow("boom");
  });
});

describe("createOrderFromQuote", () => {
  it("calls the rpc and returns the order id", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.create_order_from_quote": { data: "o9", error: null } });
    expect(await createOrderFromQuote(asClient(fake), "q1")).toBe("o9");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "rpc:werkbank.create_order_from_quote", args: [{ p_quote: "q1" }] }));
  });
});

describe("fetchOrderIdForQuote", () => {
  it("finds the order of a quote", async () => {
    const fake = createFakeSupabase({ [O]: { data: { id: "o1" }, error: null } });
    expect(await fetchOrderIdForQuote(asClient(fake), "q1")).toBe("o1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: O, method: "eq", args: ["quote_id", "q1"] }));
  });
  it("returns null when there is none", async () => {
    const fake = createFakeSupabase({ [O]: { data: null, error: null } });
    expect(await fetchOrderIdForQuote(asClient(fake), "q1")).toBeNull();
  });
});
