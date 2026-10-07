import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchNumberRange, formatNumber, saveNumberRange } from "./numberRanges";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;

describe("formatNumber", () => {
  it("pads the value to the padding width", () => {
    expect(formatNumber("KD", 5, 4)).toBe("KD0005");
  });

  it("does not pad with a padding of 0", () => {
    expect(formatNumber("K-", 10001, 0)).toBe("K-10001");
  });

  it("never truncates a value that has more digits than the padding (SQL greatest)", () => {
    expect(formatNumber("K-", 123456, 3)).toBe("K-123456");
  });

  it("works without a prefix", () => {
    expect(formatNumber("", 7, 3)).toBe("007");
  });
});

describe("fetchNumberRange", () => {
  it("returns the stored range of the org", async () => {
    const fake = createFakeSupabase({
      "werkbank.number_ranges": { data: { prefix: "KD", next_value: 42, padding: 4 }, error: null },
    });
    await expect(fetchNumberRange(asClient(fake), "org-1", "customer")).resolves.toEqual({ prefix: "KD", next_value: 42, padding: 4 });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.number_ranges", method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.number_ranges", method: "eq", args: ["key", "customer"] }));
  });

  it("returns the defaults when the row does not exist yet", async () => {
    const fake = createFakeSupabase({ "werkbank.number_ranges": { data: null, error: null } });
    await expect(fetchNumberRange(asClient(fake), "org-1", "customer")).resolves.toEqual({ prefix: "K-", next_value: 10001, padding: 0 });
  });

  it("throws a database error", async () => {
    const error = { code: "42501", message: "denied" };
    const fake = createFakeSupabase({ "werkbank.number_ranges": { data: null, error } });
    await expect(fetchNumberRange(asClient(fake), "org-1", "customer")).rejects.toBe(error);
  });
});

describe("saveNumberRange", () => {
  it("upserts on (org_id, key)", async () => {
    const fake = createFakeSupabase({ "werkbank.number_ranges": { data: null, error: null } });
    await saveNumberRange(asClient(fake), "org-1", "customer", { prefix: "KD", next_value: 500, padding: 0 });
    expect(fake.calls).toContainEqual(expect.objectContaining({
      table: "werkbank.number_ranges",
      method: "upsert",
      args: [{ org_id: "org-1", key: "customer", prefix: "KD", next_value: 500, padding: 0 }, { onConflict: "org_id,key" }],
    }));
  });

  it("without next_value never writes the counter of an existing row", async () => {
    const fake = createFakeSupabase({ "werkbank.number_ranges": { data: null, error: null } });
    await saveNumberRange(asClient(fake), "org-1", "customer", { prefix: "KD", padding: 4 });
    const writes = fake.calls.filter((c) => c.method === "upsert" || c.method === "update");
    expect(writes.map((c) => c.args)).toEqual([
      // creates a missing row with the default counter, leaves an existing row alone
      [{ org_id: "org-1", key: "customer", prefix: "KD", next_value: 10001, padding: 4 }, { onConflict: "org_id,key", ignoreDuplicates: true }],
      [{ prefix: "KD", padding: 4 }],
    ]);
    expect(fake.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["org_id", "org-1"], ["key", "customer"]]);
  });

  it("throws a database error of the prefix-only update", async () => {
    const error = { code: "42501", message: "denied" };
    const fake = createFakeSupabase({ "werkbank.number_ranges": { data: null, error } });
    await expect(saveNumberRange(asClient(fake), "org-1", "customer", { prefix: "K-", padding: 0 })).rejects.toBe(error);
  });

  it("throws a database error", async () => {
    const error = { code: "42501", message: "denied" };
    const fake = createFakeSupabase({ "werkbank.number_ranges": { data: null, error } });
    await expect(saveNumberRange(asClient(fake), "org-1", "customer", { prefix: "K-", next_value: 1, padding: 0 })).rejects.toBe(error);
  });
});
