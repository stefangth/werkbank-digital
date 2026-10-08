import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

import {
  useClearDunningHold, useDunningDue, useDunningHold, useDunningNotices, useInvoiceBalance, useInvoiceEntries,
  useOpenItems, useRecordEntry, useReverseEntry, useSetDunningHold, useTransferEntry,
} from "./useOpenItems";
import { useIssueDunning, useSendDunning } from "./useDunningActions";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;
beforeEach(() => vi.clearAllMocks());

describe("open items queries", () => {
  it("loads the balance under the org key", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.invoice_balances": { data: { invoice_id: "i1" }, error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useInvoiceBalance("i1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(queryClient.getQueryData(["werkbank", "open-items", "org-1", "balance", "i1"])).toBeDefined();
  });
  it("stays idle without an invoice id", () => {
    Object.assign(client, createFakeSupabase({}));
    expect(renderHookWithProviders(() => useInvoiceBalance(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
    expect(renderHookWithProviders(() => useInvoiceEntries(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
    expect(renderHookWithProviders(() => useDunningNotices(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
    expect(renderHookWithProviders(() => useDunningHold(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
  });
  it("loads entries, list, due, notices and hold", async () => {
    Object.assign(client, createFakeSupabase({
      "werkbank.invoice_entries": { data: [{ id: "e1" }], error: null },
      "werkbank.invoice_balances": { data: [{ invoice_id: "i1" }], error: null },
      "werkbank.dunning_due": { data: [{ invoice_id: "i1" }], error: null },
      "werkbank.dunning_notices": { data: [{ id: "n1" }], error: null },
      "werkbank.dunning_holds": { data: { invoice_id: "i1" }, error: null },
    }));
    const q = { search: "" };
    const a = renderHookWithProviders(() => useInvoiceEntries("i1"), { authOverrides });
    const b = renderHookWithProviders(() => useOpenItems(q), { authOverrides });
    const c = renderHookWithProviders(() => useDunningDue(), { authOverrides });
    const d = renderHookWithProviders(() => useDunningNotices("i1"), { authOverrides });
    const e = renderHookWithProviders(() => useDunningHold("i1"), { authOverrides });
    await waitFor(() => expect(a.result.current.data).toHaveLength(1));
    await waitFor(() => expect(b.result.current.data).toHaveLength(1));
    await waitFor(() => expect(c.result.current.data).toHaveLength(1));
    await waitFor(() => expect(d.result.current.data).toHaveLength(1));
    await waitFor(() => expect(e.result.current.data).toBeTruthy());
    expect(b.queryClient.getQueryData(["werkbank", "open-items", "org-1", "list", q])).toBeDefined();
  });
});

describe("open items mutations", () => {
  const cases: [string, string, () => unknown, unknown][] = [
    ["record", "rpc:werkbank.record_invoice_entry", () => useRecordEntry(), { invoiceId: "i1", kind: "payment", amount: 10, bookedOn: "2026-10-01" }],
    ["reverse", "rpc:werkbank.reverse_invoice_entry", () => useReverseEntry(), { entryId: "e1", reason: "x" }],
    ["transfer", "rpc:werkbank.transfer_invoice_entry", () => useTransferEntry(), { entryId: "e1", targetInvoiceId: "i2", reason: "x" }],
    ["set hold", "rpc:werkbank.set_dunning_hold", () => useSetDunningHold(), { invoiceId: "i1", reason: "x", until: null }],
    ["clear hold", "rpc:werkbank.clear_dunning_hold", () => useClearDunningHold(), "i1"],
  ];
  it.each(cases)("%s invalidates open items, invoices and the start list", async (_n, rpc, hook, vars) => {
    Object.assign(client, createFakeSupabase({ [rpc]: { data: "id", error: null } }));
    const { result, queryClient } = renderHookWithProviders(hook as () => { mutateAsync: (v: unknown) => Promise<unknown> }, { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.mutateAsync(vars); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "open-items"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "invoices"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "startList"] });
  });

  it("dunning issue and send invalidate even after a failure", async () => {
    Object.assign(client, createFakeSupabase({ "fn:werkbank-dunning": { data: null, error: new Error("boom") } }));
    const issue = renderHookWithProviders(() => useIssueDunning(), { authOverrides });
    const spy = vi.spyOn(issue.queryClient, "invalidateQueries");
    await act(async () => { await issue.result.current.mutateAsync({ invoiceId: "i1", delivery: "print" }).catch(() => undefined); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "open-items"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "invoices"] });
    const send = renderHookWithProviders(() => useSendDunning(), { authOverrides });
    const spy2 = vi.spyOn(send.queryClient, "invalidateQueries");
    await act(async () => { await send.result.current.mutateAsync({ noticeId: "n1" }).catch(() => undefined); });
    expect(spy2).toHaveBeenCalledWith({ queryKey: ["werkbank", "open-items"] });
  });
});
