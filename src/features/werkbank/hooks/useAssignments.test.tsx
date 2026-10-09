import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { useAssignment, useAssignmentActions, useAssignments, useIsTechnicianHere } from "./useAssignments";

const authOverrides = { user: { id: "u1" }, currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;
beforeEach(() => vi.clearAllMocks());

describe("useAssignments", () => {
  it("keys the list by user and org and the detail by order too", async () => {
    Object.assign(client, createFakeSupabase({
      "rpc:werkbank.my_assignments": { data: [{ id: "x" }], error: null },
      "rpc:werkbank.my_assignment": { data: { order: { id: "x" } }, error: null },
    }));
    const list = renderHookWithProviders(() => useAssignments(), { authOverrides });
    await waitFor(() => expect(list.result.current.data).toEqual([{ id: "x" }]));
    expect(list.queryClient.getQueryData(["werkbank", "assignments", "u1", "org-1"])).toBeDefined();
    const detail = renderHookWithProviders(() => useAssignment("x"), { authOverrides });
    await waitFor(() => expect(detail.result.current.data).toBeTruthy());
    expect(detail.queryClient.getQueryData(["werkbank", "assignments", "u1", "org-1", "x"])).toBeDefined();
  });
  it("stays idle without an org, a user or an order id", () => {
    Object.assign(client, createFakeSupabase());
    expect(renderHookWithProviders(() => useAssignments(), { authOverrides: { user: { id: "u1" } } as unknown as Partial<AuthContextType> }).result.current.fetchStatus).toBe("idle");
    expect(renderHookWithProviders(() => useAssignments(), { authOverrides: { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType> }).result.current.fetchStatus).toBe("idle");
    expect(renderHookWithProviders(() => useAssignment(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
  });
});

describe("useIsTechnicianHere", () => {
  it("is undefined while loading, then whether the active org is among the technician orgs", async () => {
    Object.assign(client, createFakeSupabase({ "rpc:werkbank.my_technician_orgs": { data: ["org-1"], error: null } }));
    const { result } = renderHookWithProviders(() => useIsTechnicianHere(), { authOverrides });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(true));
  });
  it("is false in an org where the user is no technician", async () => {
    Object.assign(client, createFakeSupabase({ "rpc:werkbank.my_technician_orgs": { data: ["other"], error: null } }));
    const { result } = renderHookWithProviders(() => useIsTechnicianHere(), { authOverrides });
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe("useAssignmentActions", () => {
  it("complete refreshes assignments and orders", async () => {
    Object.assign(client, createFakeSupabase());
    const { result, queryClient } = renderHookWithProviders(() => useAssignmentActions("x"), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(() => result.current.complete.mutateAsync(undefined));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "assignments"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
  });
  it("a report write refreshes only the assignments", async () => {
    Object.assign(client, createFakeSupabase({ "rpc:werkbank.create_visit_report": { data: "r1", error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useAssignmentActions("x"), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { expect(await result.current.createReport.mutateAsync(undefined)).toBe("r1"); });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([{ queryKey: ["werkbank", "assignments"] }]);
  });
  it("a database error toasts the translated message", async () => {
    Object.assign(client, createFakeSupabase({ "rpc:werkbank.lock_visit_report": { data: null, error: { code: "55000", message: "report_locked" } } }));
    const { result } = renderHookWithProviders(() => useAssignmentActions("x"), { authOverrides });
    await act(async () => { await result.current.lockReport.mutateAsync("r1").catch(() => undefined); });
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});

describe("useAssignmentActions complete", () => {
  it("stays silent on invalid_transition so the page can decide after the refetch", async () => {
    Object.assign(client, createFakeSupabase({ "rpc:werkbank.complete_assignment": { data: null, error: { code: "22023", message: "invalid_transition" } } }));
    const { result } = renderHookWithProviders(() => useAssignmentActions("x"), { authOverrides });
    await act(async () => { await result.current.complete.mutateAsync(undefined).catch(() => undefined); });
    expect(toastError).not.toHaveBeenCalled();
  });
  it("toasts other complete errors", async () => {
    Object.assign(client, createFakeSupabase({ "rpc:werkbank.complete_assignment": { data: null, error: { code: "42501", message: "not_assigned" } } }));
    const { result } = renderHookWithProviders(() => useAssignmentActions("x"), { authOverrides });
    await act(async () => { await result.current.complete.mutateAsync(undefined).catch(() => undefined); });
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});

describe("offline reading", () => {
  it("prefetches the details of overdue, today and upcoming orders only", async () => {
    const fake = createFakeSupabase({
      "rpc:werkbank.my_assignments": { data: [
        { id: "o1", group_key: "today" }, { id: "o2", group_key: "done" }, { id: "o3", group_key: "unscheduled" },
        { id: "o4", group_key: "upcoming" }, { id: "o5", group_key: "overdue" },
      ], error: null },
      "rpc:werkbank.my_assignment": { data: { order: { id: "any" } }, error: null },
    });
    Object.assign(client, fake);
    const { queryClient } = renderHookWithProviders(() => useAssignments(), { authOverrides });
    const key = (id: string) => ["werkbank", "assignments", "u1", "org-1", id];
    await waitFor(() => {
      for (const id of ["o1", "o4", "o5"]) expect(queryClient.getQueryData(key(id))).toBeDefined();
    });
    expect(queryClient.getQueryData(key("o2"))).toBeUndefined();
    expect(queryClient.getQueryData(key("o3"))).toBeUndefined();
    const fetched = fake.calls.filter((c) => c.table === "rpc:werkbank.my_assignment").map((c) => (c.args[0] as { p_order: string }).p_order);
    expect(fetched.sort()).toEqual(["o1", "o4", "o5"]);
  });

  it("reads from the cache first when offline", () => {
    Object.assign(client, createFakeSupabase());
    const { queryClient } = renderHookWithProviders(() => useAssignments(), { authOverrides });
    expect(queryClient.getQueryCache().find({ queryKey: ["werkbank", "assignments", "u1", "org-1"] })?.options.networkMode).toBe("offlineFirst");
  });

  it("refuses a write offline with the needs-a-connection toast and sends nothing", async () => {
    const fake = createFakeSupabase();
    Object.assign(client, fake);
    const offline = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      const { result } = renderHookWithProviders(() => useAssignmentActions("x"), { authOverrides });
      await act(async () => { await result.current.start.mutateAsync(undefined).catch(() => undefined); });
      expect(toastError).toHaveBeenCalledWith("Needs a connection");
      expect(fake.calls.filter((c) => c.method === "rpc")).toEqual([]);
    } finally {
      offline.mockRestore();
    }
  });
});
