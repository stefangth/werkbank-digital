import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  copyQuote, createQuote, defaultValidUntil, deleteQuote, extendQuote, fetchQuote, fetchQuoteList,
  reviseQuote, revokeQuoteLink, updateQuote,
} from "./quotes";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const Q = "werkbank.quotes";
const profile = { quote_intro: "Intro", quote_closing: "Closing", payment_terms_text: "14 Tage", quote_validity_days: 14 };

afterEach(() => vi.useRealTimers());

describe("fetchQuoteList", () => {
  it("reads the quote_list view scoped to the org", async () => {
    const fake = createFakeSupabase({ "werkbank.quote_list": { data: [{ id: "q1" }], error: null } });
    expect(await fetchQuoteList(asClient(fake), "org-1")).toEqual([{ id: "q1" }]);
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "range", args: [0, 999] }));
  });
});

describe("fetchQuote", () => {
  it("combines the row and its totals", async () => {
    const fake = createFakeSupabase({
      [Q]: { data: { id: "q1", quote_no: "A-0001" }, error: null },
      "werkbank.document_totals": { data: { quote_id: "q1", gross_total: 119 }, error: null },
    });
    expect(await fetchQuote(asClient(fake), "q1")).toEqual({
      id: "q1", quote_no: "A-0001", totals: { quote_id: "q1", gross_total: 119 },
    });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.document_totals", method: "eq", args: ["quote_id", "q1"] }));
  });
  it("returns null for a missing quote", async () => {
    const fake = createFakeSupabase({ [Q]: { data: null, error: null }, "werkbank.document_totals": { data: null, error: null } });
    expect(await fetchQuote(asClient(fake), "nope")).toBeNull();
  });
});

describe("defaultValidUntil", () => {
  it("adds the days to the Berlin date", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Berlin.
    expect(defaultValidUntil(30, new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-31");
    expect(defaultValidUntil(14, new Date("2026-10-07T10:00:00Z"))).toBe("2026-10-21");
  });
});

describe("createQuote", () => {
  it("prefills texts and validity from the profile and sends no service-only column", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
    const fake = createFakeSupabase({ [Q]: { data: { id: "q1" }, error: null } });
    const id = await createQuote(asClient(fake), "org-1", { customer_id: "c1", property_id: "p1" }, profile);
    expect(id).toBe("q1");
    const insert = fake.calls.find((c) => c.table === Q && c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toEqual({
      customer_id: "c1", property_id: "p1", org_id: "org-1",
      intro_text: "Intro", closing_text: "Closing", payment_terms_text: "14 Tage", valid_until: "2026-10-21",
    });
    for (const col of ["quote_no", "status", "version", "sent_at", "sent_to"]) expect(insert).not.toHaveProperty(col);
  });
  it("falls back to 30 days without a profile", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
    const fake = createFakeSupabase({ [Q]: { data: { id: "q1" }, error: null } });
    await createQuote(asClient(fake), "org-1", { customer_id: "c1" }, null);
    const insert = fake.calls.find((c) => c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ valid_until: "2026-11-06", intro_text: null });
  });
  it("rejects on error", async () => {
    const fake = createFakeSupabase({ [Q]: { data: null, error: new Error("boom") } });
    await expect(createQuote(asClient(fake), "org-1", { customer_id: "c1" }, null)).rejects.toThrow("boom");
  });
});

describe("update, delete, extend, revoke", () => {
  it("updateQuote patches by id", async () => {
    const fake = createFakeSupabase({ [Q]: { data: null, error: null } });
    await updateQuote(asClient(fake), "q1", { subject: "Bad" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "update", args: [{ subject: "Bad" }] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["id", "q1"] }));
  });
  it("extendQuote writes only valid_until", async () => {
    const fake = createFakeSupabase({ [Q]: { data: null, error: null } });
    await extendQuote(asClient(fake), "q1", "2026-12-01");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "update", args: [{ valid_until: "2026-12-01" }] }));
  });
  it("revokeQuoteLink stamps link_revoked_at", async () => {
    const fake = createFakeSupabase({ [Q]: { data: null, error: null } });
    await revokeQuoteLink(asClient(fake), "q1");
    const patch = fake.calls.find((c) => c.method === "update")!.args[0] as { link_revoked_at: string };
    expect(Object.keys(patch)).toEqual(["link_revoked_at"]);
    expect(new Date(patch.link_revoked_at).toString()).not.toBe("Invalid Date");
  });
  it("deleteQuote deletes by id and rejects on error", async () => {
    const fake = createFakeSupabase({ [Q]: { data: null, error: new Error("locked") } });
    await expect(deleteQuote(asClient(fake), "q1")).rejects.toThrow("locked");
    expect(fake.calls).toContainEqual(expect.objectContaining({ method: "delete" }));
  });
});

describe("reviseQuote and copyQuote", () => {
  it("reviseQuote calls the werkbank rpc and returns the new id", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.revise_quote": { data: "q2", error: null } });
    expect(await reviseQuote(asClient(fake), "q1")).toBe("q2");
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "rpc:werkbank.revise_quote", args: [{ p_quote: "q1" }] }));
  });
  it("reviseQuote rejects with the rpc error", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.revise_quote": { data: null, error: { message: "invalid_transition" } } });
    await expect(reviseQuote(asClient(fake), "q1")).rejects.toEqual({ message: "invalid_transition" });
  });
  it("copyQuote sends only the options given", async () => {
    const fake = createFakeSupabase({ "rpc:werkbank.copy_quote": { data: "q3", error: null } });
    expect(await copyQuote(asClient(fake), "q1")).toBe("q3");
    await copyQuote(asClient(fake), "q1", { customerId: "c2", propertyId: null });
    const args = fake.calls.filter((c) => c.table === "rpc:werkbank.copy_quote").map((c) => c.args[0]);
    expect(args).toEqual([{ p_quote: "q1" }, { p_quote: "q1", p_customer: "c2", p_property: null }]);
  });
});
