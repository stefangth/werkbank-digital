import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  createProperty,
  deleteProperty,
  fetchProperties,
  fetchPropertiesForCustomer,
  fetchProperty,
  setPropertyArchived,
  updateProperty,
} from "./properties";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const T = "werkbank.properties";
const JOIN = "*, customer:customers(id, kind, company_name, first_name, last_name, archived_at)";

const form = {
  customer_id: "k1", name: "WEG Musterstr. 5", object_no: "", street: "Musterstr. 5", postal_code: "01067",
  city: "Dresden", country_code: "DE", has_billing: false, billing_name: "Leftover", billing_street: "",
  billing_postal_code: "", billing_city: "", billing_country_code: "", access_notes: "", notes: "",
};

describe("fetchProperties", () => {
  it("selects the customer join, filters by org and returns the rows", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ id: "p1", customer: { id: "k1" } }], error: null } });
    const rows = await fetchProperties(asClient(fake), "org-1");
    expect(rows).toHaveLength(1);
    const calls = fake.calls.filter((c) => c.table === T);
    expect(calls).toContainEqual(expect.objectContaining({ method: "select", args: [JOIN] }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
  });

  it("rejects on a query error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(fetchProperties(asClient(fake), "org-1")).rejects.toThrow("boom");
  });
});

describe("fetchProperty", () => {
  it("returns the joined row for the id, null when missing, and throws on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "p1" }, error: null } });
    expect(await fetchProperty(asClient(fake), "p1")).toEqual({ id: "p1" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "select", args: [JOIN] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "p1"] }));
    const none = createFakeSupabase({ [T]: { data: null, error: null } });
    expect(await fetchProperty(asClient(none), "p1")).toBeNull();
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(fetchProperty(asClient(bad), "p1")).rejects.toThrow("boom");
  });
});

describe("fetchPropertiesForCustomer", () => {
  it("filters by customer_id", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ id: "p1" }], error: null } });
    expect(await fetchPropertiesForCustomer(asClient(fake), "k1")).toEqual([{ id: "p1" }]);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["customer_id", "k1"] }));
  });
});

describe("createProperty", () => {
  it("inserts with org_id and null billing columns, and returns the row", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "p1" }, error: null } });
    expect(await createProperty(asClient(fake), "org-1", form)).toEqual({ id: "p1" });
    const insert = fake.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ org_id: "org-1", customer_id: "k1", billing_name: null, object_no: null });
    expect(insert?.args[0]).not.toHaveProperty("has_billing");
  });

  it("throws the database error", async () => {
    const err = { code: "23503" };
    const fake = createFakeSupabase({ [T]: { data: null, error: err } });
    await expect(createProperty(asClient(fake), "org-1", form)).rejects.toBe(err);
  });
});

describe("updateProperty, setPropertyArchived, deleteProperty", () => {
  it("updates the row by id", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await updateProperty(asClient(fake), "p1", form);
    expect(fake.calls.find((c) => c.method === "update")?.args[0]).toMatchObject({ name: "WEG Musterstr. 5", billing_name: null });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "p1"] }));
  });

  it("archives with a timestamp and restores with null", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await setPropertyArchived(asClient(fake), "p1", true);
    await setPropertyArchived(asClient(fake), "p1", false);
    const updates = fake.calls.filter((c) => c.method === "update").map((c) => c.args[0] as { archived_at: string | null });
    expect(typeof updates[0].archived_at).toBe("string");
    expect(updates[1].archived_at).toBeNull();
  });

  it("deletes by id and throws on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await deleteProperty(asClient(fake), "p1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "delete" }));
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(deleteProperty(asClient(bad), "p1")).rejects.toThrow("boom");
  });
});
