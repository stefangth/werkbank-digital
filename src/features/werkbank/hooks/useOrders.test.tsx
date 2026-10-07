import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useOrder, useOrderList, useOrderMutations } from "./useOrders";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;

beforeEach(() => vi.clearAllMocks());

describe("order hooks", () => {
  it("loads the list under the org key", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.order_list": { data: [{ id: "o1" }], error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useOrderList(), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["werkbank", "orders", "org-1"])).toBeDefined();
  });

  it("loads a detail under the detail key and stays idle without an id", async () => {
    Object.assign(client, createFakeSupabase({
      "werkbank.orders": { data: { id: "o1" }, error: null },
      "werkbank.document_totals": { data: null, error: null },
      "werkbank.order_technicians": { data: [], error: null },
    }));
    const { result, queryClient } = renderHookWithProviders(() => useOrder("o1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(queryClient.getQueryData(["werkbank", "orders", "detail", "o1"])).toBeDefined();
    const idle = renderHookWithProviders(() => useOrder(undefined), { authOverrides });
    expect(idle.result.current.fetchStatus).toBe("idle");
  });

  it("toasts the translated database error", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.orders": { data: null, error: { code: "55000", message: "order_locked" } } }));
    const { result } = renderHookWithProviders(() => useOrderMutations(), { authOverrides });
    await act(async () => { await result.current.update.mutateAsync({ id: "o1", patch: { notes: "x" } }).catch(() => undefined); });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("createFromQuote refreshes orders, quotes and numbering", async () => {
    Object.assign(client, createFakeSupabase({ "rpc:werkbank.create_order_from_quote": { data: "o9", error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useOrderMutations(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.createFromQuote.mutateAsync("q1"); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "quotes"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "number-ranges"] });
  });

  it("create draws a number, so it refreshes orders and the numbering", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.orders": { data: { id: "o9" }, error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useOrderMutations(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.create.mutateAsync({ customer_id: "k1" }); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "number-ranges"] });
  });

  it("setStatus writes only the status and refreshes orders", async () => {
    const fake = createFakeSupabase({ "werkbank.orders": { data: null, error: null } });
    Object.assign(client, fake);
    const { result, queryClient } = renderHookWithProviders(() => useOrderMutations(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.setStatus.mutateAsync({ id: "o1", status: "in_progress" }); });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.orders", method: "update", args: [{ status: "in_progress" }] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
  });

  it("setTechnicians writes the technician set of the order and refreshes orders", async () => {
    const fake = createFakeSupabase({ "werkbank.order_technicians": { data: [{ artist_id: "a1" }], error: null } });
    Object.assign(client, fake);
    const { result, queryClient } = renderHookWithProviders(() => useOrderMutations(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.setTechnicians.mutateAsync({ orderId: "o1", artistIds: ["a1", "a2"] }); });
    expect(fake.calls).toContainEqual(expect.objectContaining({
      table: "werkbank.order_technicians",
      method: "upsert",
      args: [[{ org_id: "org-1", order_id: "o1", artist_id: "a2" }], { onConflict: "order_id,artist_id", ignoreDuplicates: true }],
    }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
  });

  it("remove deletes the order and refreshes orders and quotes (has_order changes)", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.orders": { data: [{ id: "o1" }], error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useOrderMutations(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.remove.mutateAsync("o1"); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "quotes"] });
  });
});
