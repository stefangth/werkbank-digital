import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useQuote, useQuoteList, useQuoteMutations } from "./useQuotes";
import { useDocumentItems, useItemMutations } from "./useDocumentItems";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;

beforeEach(() => vi.clearAllMocks());

describe("quote hooks", () => {
  it("loads the list under the org key", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.quote_list": { data: [{ id: "q1" }], error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useQuoteList(), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["werkbank", "quotes", "org-1"])).toBeDefined();
  });

  it("loads a detail under the detail key and stays idle without an id", async () => {
    Object.assign(client, createFakeSupabase({
      "werkbank.quotes": { data: { id: "q1" }, error: null },
      "werkbank.document_totals": { data: null, error: null },
    }));
    const { result, queryClient } = renderHookWithProviders(() => useQuote("q1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(queryClient.getQueryData(["werkbank", "quotes", "detail", "q1"])).toBeDefined();
    const idle = renderHookWithProviders(() => useQuote(undefined), { authOverrides });
    expect(idle.result.current.fetchStatus).toBe("idle");
  });

  it("toasts the translated database error", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.quotes": { data: null, error: { code: "55000", message: "quote_locked" } } }));
    const { result } = renderHookWithProviders(() => useQuoteMutations(), { authOverrides });
    await act(async () => { await result.current.update.mutateAsync({ id: "q1", patch: { subject: "x" } }).catch(() => undefined); });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe("item hooks", () => {
  it("loads items under the ref key", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.document_items": { data: [{ id: "i1" }], error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useDocumentItems({ quoteId: "q1" }), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["werkbank", "items", "quote_id:q1"])).toBeDefined();
  });

  it("invalidates the parent detail after an item mutation", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.document_items": { data: null, error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useItemMutations({ quoteId: "q1" }), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.remove.mutateAsync("i1"); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "quotes"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "items", "quote_id:q1"] });
  });

  it("also invalidates the orders domain for an order item mutation", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.document_items": { data: null, error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useItemMutations({ orderId: "o1" }), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.remove.mutateAsync("i1"); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "items", "order_id:o1"] });
  });
});
