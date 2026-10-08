import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchBalanceMap, fetchCustomerCredit, fetchInvoiceBalance, fetchInvoiceEntries, fetchOpenItems, fetchTransferDestinations, fetchTransferTargets,
  recordInvoiceEntry, reverseInvoiceEntry, transferInvoiceEntry,
} from "./invoiceEntries";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const T = (n: string) => `werkbank.${n}`;

describe("reads", () => {
  it("fetchInvoiceBalance filters org and invoice", async () => {
    const fake = createFakeSupabase({ [T("invoice_balances")]: { data: { invoice_id: "i1" }, error: null } });
    expect(await fetchInvoiceBalance(asClient(fake), "o1", "i1")).toEqual({ invoice_id: "i1" });
    expect(fake.calls).toContainEqual({ table: T("invoice_balances"), method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: T("invoice_balances"), method: "eq", args: ["invoice_id", "i1"] });
  });
  it("fetchInvoiceEntries orders oldest first", async () => {
    const fake = createFakeSupabase({ [T("invoice_entries")]: { data: [{ id: "e1" }], error: null } });
    expect(await fetchInvoiceEntries(asClient(fake), "o1", "i1")).toEqual([{ id: "e1" }]);
    expect(fake.calls).toContainEqual({ table: T("invoice_entries"), method: "eq", args: ["invoice_id", "i1"] });
    expect(fake.calls).toContainEqual({ table: T("invoice_entries"), method: "order", args: ["created_at", { ascending: true }] });
  });
  it("fetchOpenItems excludes settled rows and orders by days overdue", async () => {
    const fake = createFakeSupabase({ [T("invoice_balances")]: { data: [{ invoice_id: "i1" }], error: null } });
    const rows = await fetchOpenItems(asClient(fake), "o1", { search: "", customerId: "c1", overdueOnly: true });
    expect(rows).toEqual([{ invoice_id: "i1" }]);
    const calls = fake.calls.filter((c) => c.table === T("invoice_balances"));
    expect(calls).toContainEqual({ table: T("invoice_balances"), method: "eq", args: ["org_id", "o1"] });
    expect(calls).toContainEqual({ table: T("invoice_balances"), method: "neq", args: ["open_amount", 0] });
    expect(calls).toContainEqual({ table: T("invoice_balances"), method: "eq", args: ["customer_id", "c1"] });
    expect(calls).toContainEqual({ table: T("invoice_balances"), method: "gt", args: ["days_overdue", 0] });
    expect(calls).toContainEqual({ table: T("invoice_balances"), method: "order", args: ["days_overdue", { ascending: false }] });
  });
  it("fetchOpenItems searches number and customer", async () => {
    const fake = createFakeSupabase({ [T("invoice_balances")]: { data: [], error: null } });
    await fetchOpenItems(asClient(fake), "o1", { search: "Mül,ler" });
    const or = fake.calls.find((c) => c.method === "or");
    expect(or?.args[0]).toContain("invoice_no.ilike.%Mül ler%");
    expect(or?.args[0]).toContain("customer_name.ilike.%Mül ler%");
  });
  it("fetchCustomerCredit sums the negative open amounts as a positive number", async () => {
    const fake = createFakeSupabase({ [T("invoice_balances")]: { data: [{ open_amount: -110 }, { open_amount: -40.5 }], error: null } });
    expect(await fetchCustomerCredit(asClient(fake), "o1")).toBe(150.5);
    expect(fake.calls).toContainEqual({ table: T("invoice_balances"), method: "lt", args: ["open_amount", 0] });
  });
  it("fetchTransferTargets lists issued invoices of the customer, newest first, without the source", async () => {
    const fake = createFakeSupabase({ [T("invoice_list")]: { data: [{ id: "i2" }], error: null } });
    expect(await fetchTransferTargets(asClient(fake), "o1", "c1", "i1")).toEqual([{ id: "i2" }]);
    const c = fake.calls;
    expect(c).toContainEqual({ table: T("invoice_list"), method: "eq", args: ["customer_id", "c1"] });
    expect(c).toContainEqual({ table: T("invoice_list"), method: "eq", args: ["status", "issued"] });
    expect(c).toContainEqual({ table: T("invoice_list"), method: "neq", args: ["id", "i1"] });
    expect(c).toContainEqual({ table: T("invoice_list"), method: "order", args: ["issue_date", { ascending: false }] });
  });
});

describe("rpcs", () => {
  it("recordInvoiceEntry passes the named arguments", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.record_invoice_entry": { data: "e1", error: null } });
    expect(await recordInvoiceEntry(asClient(fake), {
      invoiceId: "i1", kind: "write_off", amount: 10, bookedOn: "2026-10-08", note: "n", writeOffReason: "skonto",
    })).toBe("e1");
    expect(fake.calls).toContainEqual(expect.objectContaining({
      method: "rpc",
      args: [{ p_invoice: "i1", p_kind: "write_off", p_amount: 10, p_booked_on: "2026-10-08", p_note: "n", p_write_off_reason: "skonto" }],
    }));
  });
  it("recordInvoiceEntry omits a missing note and reason", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.record_invoice_entry": { data: "e1", error: null } });
    await recordInvoiceEntry(asClient(fake), { invoiceId: "i1", kind: "payment", amount: 5, bookedOn: "2026-10-08" });
    expect(fake.calls).toContainEqual(expect.objectContaining({
      args: [{ p_invoice: "i1", p_kind: "payment", p_amount: 5, p_booked_on: "2026-10-08", p_note: undefined, p_write_off_reason: undefined }],
    }));
  });
  it("reverseInvoiceEntry and transferInvoiceEntry", async () => {
    const fake = createFakeSupabase({
      "rpc:werkbank.reverse_invoice_entry": { data: null, error: null },
      "rpc:werkbank.transfer_invoice_entry": { data: "e2", error: null },
    });
    await reverseInvoiceEntry(asClient(fake), "e1", "Irrtum");
    expect(await transferInvoiceEntry(asClient(fake), "e1", "i2", "falsche Rechnung")).toBe("e2");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "rpc:werkbank.reverse_invoice_entry", args: [{ p_entry: "e1", p_reason: "Irrtum" }] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({
      table: "rpc:werkbank.transfer_invoice_entry", args: [{ p_entry: "e1", p_target_invoice: "i2", p_reason: "falsche Rechnung" }],
    }));
  });
  it("throws the database error", async () => {
    const error = { code: "22023", message: "nothing_open" };
    const fake = createFakeSupabase({ "rpc:werkbank.record_invoice_entry": { data: null, error } });
    await expect(recordInvoiceEntry(asClient(fake), { invoiceId: "i1", kind: "payment", amount: 5, bookedOn: "2026-10-08" })).rejects.toBe(error);
  });
});

describe("fetchBalanceMap", () => {
  it("keys the org's balance rows by invoice id, reads in pages and ignores rows without an id", async () => {
    const fake = createFakeSupabase({ [T("invoice_balances")]: { data: [
      { invoice_id: "i1", open_amount: 5 }, { invoice_id: null, open_amount: 9 }, { invoice_id: "i2", open_amount: 0 },
    ], error: null } });
    const map = await fetchBalanceMap(asClient(fake), "org-1");
    expect([...map.keys()]).toEqual(["i1", "i2"]);
    expect(map.get("i1")?.open_amount).toBe(5);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "range", args: [0, 999] }));
  });
  it("throws the database error", async () => {
    const error = { code: "42501" };
    const fake = createFakeSupabase({ [T("invoice_balances")]: { data: null, error } });
    await expect(fetchBalanceMap(asClient(fake), "org-1")).rejects.toBe(error);
  });
});

describe("fetchTransferDestinations", () => {
  it("maps each transferred entry to the invoice its copy was booked on", async () => {
    const fake = createFakeSupabase({
      [T("invoice_entries")]: { data: [{ transferred_from: "e1", invoice_id: "i2" }], error: null },
      [T("invoices")]: { data: [{ id: "i2", invoice_no: "RE-0002" }], error: null },
    });
    const map = await fetchTransferDestinations(asClient(fake), "o1", ["e1", "e9"]);
    expect([...map]).toEqual([["e1", { invoiceId: "i2", invoiceNo: "RE-0002" }]]);
    expect(fake.calls).toContainEqual({ table: T("invoice_entries"), method: "in", args: ["transferred_from", ["e1", "e9"]] });
    expect(fake.calls).toContainEqual({ table: T("invoices"), method: "in", args: ["id", ["i2"]] });
    expect(fake.calls).toContainEqual({ table: T("invoices"), method: "eq", args: ["org_id", "o1"] });
  });
  it("asks nothing without entries", async () => {
    const fake = createFakeSupabase({});
    expect((await fetchTransferDestinations(asClient(fake), "o1", [])).size).toBe(0);
    expect(fake.calls).toEqual([]);
  });
});
