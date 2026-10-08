import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { clearDunningHold, fetchDunningDue, fetchDunningHold, fetchDunningNotices, setDunningHold } from "./dunning";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const T = (n: string) => `werkbank.${n}`;

describe("dunning data", () => {
  it("fetchDunningNotices lists by stage", async () => {
    const fake = createFakeSupabase({ [T("dunning_notices")]: { data: [{ id: "n1" }], error: null } });
    expect(await fetchDunningNotices(asClient(fake), "o1", "i1")).toEqual([{ id: "n1" }]);
    expect(fake.calls).toContainEqual({ table: T("dunning_notices"), method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: T("dunning_notices"), method: "eq", args: ["invoice_id", "i1"] });
    expect(fake.calls).toContainEqual({ table: T("dunning_notices"), method: "order", args: ["stage", { ascending: true }] });
  });
  it("fetchDunningHold returns null when none", async () => {
    const fake = createFakeSupabase({ [T("dunning_holds")]: { data: null, error: null } });
    expect(await fetchDunningHold(asClient(fake), "o1", "i1")).toBeNull();
  });
  it("fetchDunningDue reads the view for the org", async () => {
    const fake = createFakeSupabase({ [T("dunning_due")]: { data: [{ invoice_id: "i1" }], error: null } });
    expect(await fetchDunningDue(asClient(fake), "o1")).toEqual([{ invoice_id: "i1" }]);
    expect(fake.calls).toContainEqual({ table: T("dunning_due"), method: "eq", args: ["org_id", "o1"] });
  });
  it("hold rpcs", async () => {
    const fake = createFakeSupabase({
      "rpc:werkbank.set_dunning_hold": { data: null, error: null },
      "rpc:werkbank.clear_dunning_hold": { data: null, error: null },
    });
    await setDunningHold(asClient(fake), "i1", "Stundung", "2026-11-01");
    await setDunningHold(asClient(fake), "i1", "Klärung", null);
    await clearDunningHold(asClient(fake), "i1");
    const rpcs = fake.calls.filter((c) => c.method === "rpc").map((c) => [c.table, c.args[0]]);
    expect(rpcs).toEqual([
      ["rpc:werkbank.set_dunning_hold", { p_invoice: "i1", p_reason: "Stundung", p_until: "2026-11-01" }],
      ["rpc:werkbank.set_dunning_hold", { p_invoice: "i1", p_reason: "Klärung", p_until: undefined }],
      ["rpc:werkbank.clear_dunning_hold", { p_invoice: "i1" }],
    ]);
  });
});
