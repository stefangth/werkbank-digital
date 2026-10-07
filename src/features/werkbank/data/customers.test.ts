import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  createCustomer,
  deleteCustomer,
  fetchCustomer,
  fetchCustomers,
  setCustomerArchived,
  updateCustomer,
} from "./customers";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const T = "werkbank.customers";

const form = {
  kind: "property_manager" as const,
  company_name: "Muster GmbH",
  first_name: "",
  last_name: "",
  street: "Hauptstr. 1",
  postal_code: "01067",
  city: "Dresden",
  country_code: "DE",
  email: "",
  invoice_email: "",
  phone: "",
  vat_id: "",
  payment_terms_days: "14",
  notes: "",
  customer_no: "",
};

describe("fetchCustomers", () => {
  it("maps the properties count embed to property_count and filters by org", async () => {
    const fake = createFakeSupabase({
      [T]: { data: [{ id: "k1", properties: [{ count: 2 }] }, { id: "k2", properties: [] }], error: null },
    });
    const rows = await fetchCustomers(asClient(fake), "org-1");
    expect(rows.map((r) => [r.id, r.property_count])).toEqual([["k1", 2], ["k2", 0]]);
    expect(rows[0]).not.toHaveProperty("properties");
    const calls = fake.calls.filter((c) => c.table === T);
    expect(calls).toContainEqual(expect.objectContaining({ method: "select", args: ["*, properties(count)"] }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
  });

  it("rejects on a query error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(fetchCustomers(asClient(fake), "org-1")).rejects.toThrow("boom");
  });
});

describe("fetchCustomer", () => {
  it("returns the row for the id", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "k1" }, error: null } });
    expect(await fetchCustomer(asClient(fake), "k1")).toEqual({ id: "k1" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "k1"] }));
  });

  it("returns null when there is none, and throws on error", async () => {
    const none = createFakeSupabase({ [T]: { data: null, error: null } });
    expect(await fetchCustomer(asClient(none), "k1")).toBeNull();
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(fetchCustomer(asClient(bad), "k1")).rejects.toThrow("boom");
  });
});

describe("createCustomer", () => {
  it("inserts with org_id, no customer_no, and returns the row with the assigned number", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "k1", customer_no: "K-10001" }, error: null } });
    const created = await createCustomer(asClient(fake), "org-1", form);
    expect(created.customer_no).toBe("K-10001");
    const insert = fake.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ org_id: "org-1", company_name: "Muster GmbH", vat_id: null, payment_terms_days: 14 });
    expect(insert?.args[0]).not.toHaveProperty("customer_no");
  });

  it("throws the database error", async () => {
    const err = { code: "23505", message: "customers_customer_no_unique" };
    const fake = createFakeSupabase({ [T]: { data: null, error: err } });
    await expect(createCustomer(asClient(fake), "org-1", form)).rejects.toBe(err);
  });
});

describe("updateCustomer", () => {
  it("updates by id without org_id", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await updateCustomer(asClient(fake), "k1", { ...form, kind: "private", last_name: "Meier", company_name: "Alt GmbH" });
    const update = fake.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({ kind: "private", company_name: null, last_name: "Meier" });
    expect(update?.args[0]).not.toHaveProperty("org_id");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "k1"] }));
  });
});

describe("setCustomerArchived", () => {
  it("archives with an ISO timestamp and restores with null", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await setCustomerArchived(asClient(fake), "k1", true);
    await setCustomerArchived(asClient(fake), "k1", false);
    const updates = fake.calls.filter((c) => c.method === "update").map((c) => c.args[0] as { archived_at: string | null });
    expect(new Date(updates[0].archived_at!).toISOString()).toBe(updates[0].archived_at);
    expect(updates[1].archived_at).toBeNull();
  });
});

describe("deleteCustomer", () => {
  it("deletes by id and throws on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await deleteCustomer(asClient(fake), "k1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "delete" }));
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("fk") } });
    await expect(deleteCustomer(asClient(bad), "k1")).rejects.toThrow("fk");
  });
});
