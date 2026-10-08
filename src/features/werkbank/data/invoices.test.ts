import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  cancelInvoice, copyInvoice, createFreeInvoice, createInvoiceFromOrder, deleteInvoice, fetchActiveInvoiceForOrder,
  fetchInvoice, fetchInvoices, updateInvoice,
} from "./invoices";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const T = "werkbank.invoices";
const profile = { invoice_intro: "Intro", invoice_closing: "Closing", payment_terms_text: "14 Tage netto", payment_due_days: 21 };

describe("fetchInvoices", () => {
  it("reads invoice_list scoped to the org, without a status filter for all", async () => {
    const fake = createFakeSupabase({ "werkbank.invoice_list": { data: [{ id: "i1" }], error: null } });
    expect(await fetchInvoices(asClient(fake), "org-1", { filter: "all", search: "" })).toEqual([{ id: "i1" }]);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls.some((c) => c.method === "eq" && c.args[0] === "status")).toBe(false);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "range", args: [0, 999] }));
  });
  it("adds the status filter for issued", async () => {
    const fake = createFakeSupabase({ "werkbank.invoice_list": { data: [], error: null } });
    await fetchInvoices(asClient(fake), "org-1", { filter: "issued", search: "" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["status", "issued"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
  });
  it("narrows by customer and property", async () => {
    const fake = createFakeSupabase({ "werkbank.invoice_list": { data: [], error: null } });
    await fetchInvoices(asClient(fake), "org-1", { filter: "draft", search: "", customerId: "c1", propertyId: "p1" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["customer_id", "c1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["property_id", "p1"] }));
  });
  it("searches number, customer, property and subject, and strips filter syntax", async () => {
    const fake = createFakeSupabase({ "werkbank.invoice_list": { data: [], error: null } });
    await fetchInvoices(asClient(fake), "org-1", { filter: "all", search: "Mül,\"ler)" });
    const or = fake.calls.find((c) => c.method === "or")!.args[0] as string;
    expect(or).toBe("invoice_no.ilike.%Mül ler%,customer_name.ilike.%Mül ler%,property_name.ilike.%Mül ler%,subject.ilike.%Mül ler%");
  });
  it("throws the database error", async () => {
    const error = { code: "42501" };
    const fake = createFakeSupabase({ "werkbank.invoice_list": { data: null, error } });
    await expect(fetchInvoices(asClient(fake), "org-1", { filter: "all", search: "" })).rejects.toBe(error);
  });
});

describe("fetchInvoice", () => {
  it("combines the row and its totals, scoped to the org", async () => {
    const fake = createFakeSupabase({
      [T]: { data: { id: "i1" }, error: null },
      "werkbank.document_totals": { data: { invoice_id: "i1", gross_total: 119 }, error: null },
    });
    expect(await fetchInvoice(asClient(fake), "org-1", "i1")).toEqual({ id: "i1", totals: { invoice_id: "i1", gross_total: 119 } });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: T, method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.document_totals", method: "eq", args: ["invoice_id", "i1"] }));
  });
  it("returns null for a missing invoice", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null }, "werkbank.document_totals": { data: null, error: null } });
    expect(await fetchInvoice(asClient(fake), "org-1", "nope")).toBeNull();
  });
});

describe("fetchActiveInvoiceForOrder", () => {
  it("looks for a non-cancelled invoice of the order", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "i1", invoice_no: "RE-0001" }, error: null } });
    expect(await fetchActiveInvoiceForOrder(asClient(fake), "org-1", "o1")).toEqual({ id: "i1", invoice_no: "RE-0001" });
    const eqs = fake.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual(expect.arrayContaining([["org_id", "org-1"], ["order_id", "o1"], ["type", "invoice"]]));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "neq", args: ["status", "cancelled"] }));
  });
  it("returns null without one", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    expect(await fetchActiveInvoiceForOrder(asClient(fake), "org-1", "o1")).toBeNull();
  });
});

describe("createFreeInvoice", () => {
  it("prefills texts and payment_due_days from the profile and sends no service-only column", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "i1" }, error: null } });
    expect(await createFreeInvoice(asClient(fake), "org-1", { customerId: "c1", propertyId: "p1", profile })).toBe("i1");
    const insert = fake.calls.find((c) => c.table === T && c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toEqual({
      org_id: "org-1", customer_id: "c1", property_id: "p1",
      intro_text: "Intro", closing_text: "Closing", payment_terms_text: "14 Tage netto", payment_due_days: 21,
    });
    for (const col of ["invoice_no", "status", "type", "seller_snapshot"]) expect(insert).not.toHaveProperty(col);
  });
  it("leaves payment_due_days to the database default without a profile", async () => {
    const fake = createFakeSupabase({ [T]: { data: { id: "i1" }, error: null } });
    await createFreeInvoice(asClient(fake), "org-1", { customerId: "c1", profile: null });
    const insert = fake.calls.find((c) => c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ property_id: null, intro_text: null });
    expect(insert).not.toHaveProperty("payment_due_days");
  });
  it("rejects on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: new Error("boom") } });
    await expect(createFreeInvoice(asClient(fake), "org-1", { customerId: "c1", profile: null })).rejects.toThrow("boom");
  });
});

describe("updateInvoice and deleteInvoice", () => {
  it("update filters by org and id", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await updateInvoice(asClient(fake), "org-1", "i1", { subject: "x" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "update", args: [{ subject: "x" }] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "i1"] }));
  });
  it("delete filters by org and id and rejects on error", async () => {
    const fake = createFakeSupabase({ [T]: { data: null, error: null } });
    await deleteInvoice(asClient(fake), "org-1", "i1");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "delete" }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    const bad = createFakeSupabase({ [T]: { data: null, error: new Error("locked") } });
    await expect(deleteInvoice(asClient(bad), "org-1", "i1")).rejects.toThrow("locked");
  });
});

describe("rpcs", () => {
  it.each([
    ["create_invoice_from_order", { p_order: "o1" }, (c: SupabaseClient<Database>) => createInvoiceFromOrder(c, "o1")],
    ["cancel_invoice", { p_invoice: "i1" }, (c: SupabaseClient<Database>) => cancelInvoice(c, "i1")],
    ["copy_invoice", { p_invoice: "i1" }, (c: SupabaseClient<Database>) => copyInvoice(c, "i1")],
  ])("%s returns the new id", async (name, args, run) => {
    const fake = createFakeSupabase({ [`rpc:werkbank.${name}`]: { data: "new-id", error: null } });
    expect(await run(asClient(fake))).toBe("new-id");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: `rpc:werkbank.${name}`, method: "rpc", args: [args] }));
  });
});
