import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  createOrder, createOrderFromQuote, fetchOrder, fetchOrderList, setOrderStatus, setOrderTechnicians, updateOrder,
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
    });
    expect(await fetchOrder(asClient(fake), "o1")).toEqual({
      id: "o1", order_no: "AU-0001", totals: { order_id: "o1", gross_total: 119 }, technician_ids: ["a1", "a2"],
    });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.document_totals", method: "eq", args: ["order_id", "o1"] }));
  });
  it("returns null for a missing order", async () => {
    const fake = createFakeSupabase({
      [O]: { data: null, error: null }, "werkbank.document_totals": { data: null, error: null }, [T]: { data: [], error: null },
    });
    expect(await fetchOrder(asClient(fake), "nope")).toBeNull();
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
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: T, method: "in", args: ["artist_id", ["a"]] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: T, method: "insert", args: [[{ org_id: "org-1", order_id: "o1", artist_id: "c" }]] }));
  });
  it("does nothing when the set is unchanged", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ artist_id: "a" }], error: null } });
    await setOrderTechnicians(asClient(fake), "org-1", "o1", ["a"]);
    expect(fake.calls.some((c) => c.method === "delete" || c.method === "insert")).toBe(false);
  });
});

describe("createOrderFromQuote", () => {
  it("calls the rpc and returns the order id", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.create_order_from_quote": { data: "o9", error: null } });
    expect(await createOrderFromQuote(asClient(fake), "q1")).toBe("o9");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "rpc:werkbank.create_order_from_quote", args: [{ p_quote: "q1" }] }));
  });
});
