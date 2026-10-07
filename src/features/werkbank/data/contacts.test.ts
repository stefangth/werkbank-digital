import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createContact, deleteContact, fetchContacts, setPrimaryContact, updateContact } from "./contacts";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const T = "werkbank.contacts";
const form = { first_name: "Anna", last_name: "Meier", role: "", phone: "", mobile: "", email: "", notes: "", is_primary: false };

describe("fetchContacts", () => {
  it("filters by customer_id and orders primary first, then last name", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ id: "c1" }], error: null } });
    expect(await fetchContacts(asClient(fake), { customerId: "k1" })).toEqual([{ id: "c1" }]);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["customer_id", "k1"] }));
    const orders = fake.calls.filter((c) => c.method === "order").map((c) => c.args[0]);
    expect(orders.slice(0, 2)).toEqual(["is_primary", "last_name"]);
    expect(fake.calls.find((c) => c.method === "order")?.args[1]).toEqual({ ascending: false });
  });

  it("filters by property_id for a property parent and throws on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: [], error: null } });
    await fetchContacts(asClient(fake), { propertyId: "p1" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["property_id", "p1"] }));
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(fetchContacts(asClient(bad), { propertyId: "p1" })).rejects.toThrow("boom");
  });
});

describe("createContact", () => {
  it("sets only property_id for a property parent and customer_id null", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "c1" }, error: null } });
    await createContact(asClient(fake), "org-1", { propertyId: "p1" }, form);
    const insert = fake.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ org_id: "org-1", property_id: "p1", customer_id: null, last_name: "Meier", role: null });
  });

  it("sets only customer_id for a customer parent", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "c1" }, error: null } });
    await createContact(asClient(fake), "org-1", { customerId: "k1" }, form);
    expect(fake.calls.find((c) => c.method === "insert")?.args[0]).toMatchObject({ customer_id: "k1", property_id: null });
  });

  it("does not touch the primary flag of others for a non-primary contact", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "c1" }, error: null } });
    await createContact(asClient(fake), "org-1", { customerId: "k1" }, form);
    expect(fake.calls.filter((c) => c.method === "update")).toHaveLength(0);
  });

  it("promotes a new primary contact after inserting it as a normal one", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "c1" }, error: null } });
    const created = await createContact(asClient(fake), "org-1", { customerId: "k1" }, { ...form, is_primary: true });
    const writes = fake.calls.filter((c) => c.method === "insert" || c.method === "update");
    expect(writes.map((c) => [c.method, (c.args[0] as { is_primary: boolean }).is_primary])).toEqual([
      ["insert", false], ["update", false], ["update", true],
    ]);
    expect(created.is_primary).toBe(true);
  });

  it("throws the database error", async () => {
    const err = { code: "23505" };
    const fake = createFakeSupabase({ [T]: { data: null, error: err } });
    await expect(createContact(asClient(fake), "org-1", { customerId: "k1" }, form)).rejects.toBe(err);
  });
});

describe("setPrimaryContact", () => {
  it("clears the other primary of the parent before setting this one", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await setPrimaryContact(asClient(fake), { propertyId: "p1" }, "c1");
    const calls = fake.calls.filter((c) => c.table === T);
    const updates = calls.filter((c) => c.method === "update");
    expect(updates.map((c) => c.args[0])).toEqual([{ is_primary: false }, { is_primary: true }]);
    const clearAt = calls.indexOf(updates[0]);
    const setAt = calls.indexOf(updates[1]);
    expect(clearAt).toBeLessThan(setAt);
    const clearFilters = calls.slice(clearAt, setAt);
    expect(clearFilters).toContainEqual(expect.objectContaining({ method: "eq", args: ["property_id", "p1"] }));
    expect(clearFilters).toContainEqual(expect.objectContaining({ method: "neq", args: ["id", "c1"] }));
    expect(calls.slice(setAt)).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "c1"] }));
  });

  it("scopes the clear to the customer for a customer parent, and stops on a clear error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await setPrimaryContact(asClient(fake), { customerId: "k1" }, "c1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["customer_id", "k1"] }));
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(setPrimaryContact(asClient(bad), { customerId: "k1" }, "c1")).rejects.toThrow("boom");
    expect(bad.calls.filter((c) => c.method === "update")).toHaveLength(1);
  });
});

describe("updateContact and deleteContact", () => {
  it("updates the row by id without promoting a non-primary contact", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await updateContact(asClient(fake), { customerId: "k1" }, "c1", form);
    const updates = fake.calls.filter((c) => c.method === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ last_name: "Meier", is_primary: false });
  });

  it("never sends is_primary false when updating a primary contact, then promotes it", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await updateContact(asClient(fake), { customerId: "k1" }, "c1", { ...form, is_primary: true });
    const updates = fake.calls.filter((c) => c.method === "update").map((c) => c.args[0] as Record<string, unknown>);
    expect(updates[0]).not.toHaveProperty("is_primary");
    expect(updates[0]).toMatchObject({ last_name: "Meier" });
    expect(updates.slice(1)).toEqual([{ is_primary: false }, { is_primary: true }]);
    expect(updates.filter((u) => u.is_primary === false && "last_name" in u)).toHaveLength(0);
  });

  it("deletes by id and throws on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await deleteContact(asClient(fake), "c1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "delete" }));
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(deleteContact(asClient(bad), "c1")).rejects.toThrow("boom");
  });
});
