import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchVisitReports, updateOfficeNote } from "./visitReports";

const asClient = (fake: unknown) => fake as SupabaseClient<Database>;
const T = "werkbank.visit_reports";

describe("fetchVisitReports", () => {
  it("filters org and order, orders by visit date and sorts photos by position", async () => {
    const fake = createFakeSupabase({ [T]: { data: [{ id: "r1", photos: [{ id: "b", position: 1 }, { id: "a", position: 0 }] }, { id: "r2" }], error: null } });
    const rows = await fetchVisitReports(asClient(fake), "o1", "x");
    expect(rows[0].photos.map((p) => p.id)).toEqual(["a", "b"]);
    expect(rows[1].photos).toEqual([]);
    expect(fake.calls).toContainEqual({ table: T, method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: T, method: "eq", args: ["order_id", "x"] });
    expect(fake.calls).toContainEqual({ table: T, method: "order", args: ["visit_date", { ascending: true }] });
  });
  it("throws a database error", async () => {
    const error = new Error("x");
    await expect(fetchVisitReports(asClient(createFakeSupabase({ [T]: { data: null, error } })), "o1", "x")).rejects.toBe(error);
  });
});

describe("updateOfficeNote", () => {
  it("updates only office_note on the report", async () => {
    const fake = createFakeSupabase();
    await updateOfficeNote(asClient(fake), "r1", "Rückruf");
    expect(fake.calls).toContainEqual({ table: T, method: "update", args: [{ office_note: "Rückruf" }] });
    expect(fake.calls).toContainEqual({ table: T, method: "eq", args: ["id", "r1"] });
  });
  it("throws a database error", async () => {
    const error = new Error("x");
    await expect(updateOfficeNote(asClient(createFakeSupabase({ [T]: { data: null, error } })), "r1", null)).rejects.toBe(error);
  });
});
