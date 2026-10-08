import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { downloadVisitReportPdf, fetchVisitReports, updateOfficeNote, VisitReportPdfError, visitReportPdfErrorKey } from "./visitReports";

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

describe("downloadVisitReportPdf", () => {
  const FN = "fn:werkbank-reports";
  it("asks for all reports of the order and returns the blob", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const fake = createFakeSupabase({ [FN]: { data: blob, error: null } });
    expect(await downloadVisitReportPdf(asClient(fake), { orgId: "o1", orderId: "x" })).toBe(blob);
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ org_id: "o1", order_id: "x" }] });
  });
  it("passes the selected reports", async () => {
    const fake = createFakeSupabase({ [FN]: { data: new Blob([]), error: null } });
    await downloadVisitReportPdf(asClient(fake), { orgId: "o1", orderId: "x", reportIds: ["r1"] });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ org_id: "o1", order_id: "x", report_ids: ["r1"] }] });
  });
  const fail = (status: number, json: unknown) =>
    createFakeSupabase({ [FN]: { data: null, error: { context: new Response(JSON.stringify(json), { status }) } } });
  const keyOf = (fake: ReturnType<typeof createFakeSupabase>) =>
    downloadVisitReportPdf(asClient(fake), { orgId: "o1", orderId: "x" }).then(() => "resolved", visitReportPdfErrorKey);
  it("maps an incomplete company profile, no reports and anything else to their keys", async () => {
    expect(await keyOf(fail(422, { error: "preflight_failed", blockers: ["profile_incomplete"] }))).toBe("orders.reports.pdfProfileIncomplete");
    expect(await keyOf(fail(404, { error: "no_reports" }))).toBe("orders.reports.pdfNoReports");
    expect(await keyOf(fail(500, { error: "render_failed" }))).toBe("invoices.page.pdfFailed");
    expect(await keyOf(createFakeSupabase({ [FN]: { data: null, error: new Error("x") } }))).toBe("invoices.page.pdfFailed");
  });
  it("throws a VisitReportPdfError with the code", async () => {
    await expect(downloadVisitReportPdf(asClient(fail(404, { error: "no_reports" })), { orgId: "o1", orderId: "x" }))
      .rejects.toEqual(new VisitReportPdfError("no_reports"));
  });
});
