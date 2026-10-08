import { describe, it, expect, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

import { useUpdateOfficeNote, useVisitReportPdf, useVisitReports } from "./useVisitReports";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;

describe("useVisitReports", () => {
  it("loads under the org and order key and stays idle without an order", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.visit_reports": { data: [{ id: "r1", photos: [] }], error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useVisitReports("x"), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["werkbank", "visit-reports", "org-1", "x"])).toBeDefined();
    expect(renderHookWithProviders(() => useVisitReports(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
  });
  it("the office note refreshes the visit reports", async () => {
    Object.assign(client, createFakeSupabase());
    const { result, queryClient } = renderHookWithProviders(() => useUpdateOfficeNote("x"), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(() => result.current.mutateAsync({ reportId: "r1", note: "n" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "visit-reports"] });
  });
  it("the PDF asks werkbank-reports for the active org and order", async () => {
    const blob = new Blob(["%PDF"]);
    const fake = createFakeSupabase({ "fn:werkbank-reports": { data: blob, error: null } });
    Object.assign(client, fake);
    const { result } = renderHookWithProviders(() => useVisitReportPdf("x"), { authOverrides });
    expect(await act(() => result.current.mutateAsync(["r1"]))).toBe(blob);
    expect(fake.calls).toContainEqual({ table: "fn:werkbank-reports", method: "invoke", args: [{ org_id: "org-1", order_id: "x", report_ids: ["r1"] }] });
  });
});
