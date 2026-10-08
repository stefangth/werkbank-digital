import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useActiveInvoiceForOrder, useInvoice, useInvoiceMutations, useInvoices } from "./useInvoices";
import { useInvoiceDownload, useIssueInvoice, usePreviewInvoice, useSendInvoice } from "./useInvoiceActions";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;
const query = { filter: "all", search: "" } as const;

beforeEach(() => vi.clearAllMocks());

describe("invoice queries", () => {
  it("loads the list under the org key", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.invoice_list": { data: [{ id: "i1" }], error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useInvoices(query), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["werkbank", "invoices", "org-1", query])).toBeDefined();
  });

  it("loads a detail and stays idle without an id", async () => {
    Object.assign(client, createFakeSupabase({
      "werkbank.invoices": { data: { id: "i1" }, error: null },
      "werkbank.document_totals": { data: null, error: null },
    }));
    const { result } = renderHookWithProviders(() => useInvoice("i1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(renderHookWithProviders(() => useInvoice(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
  });

  it("loads the active invoice of an order", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.invoices": { data: { id: "i1", invoice_no: "RE-0001" }, error: null } }));
    const { result } = renderHookWithProviders(() => useActiveInvoiceForOrder("o1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toEqual({ id: "i1", invoice_no: "RE-0001" }));
    expect(renderHookWithProviders(() => useActiveInvoiceForOrder(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
  });
});

describe("useInvoiceMutations", () => {
  it("invalidates only invoices after an update", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.invoices": { data: null, error: null } }));
    const { result, queryClient } = renderHookWithProviders(() => useInvoiceMutations(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.update.mutateAsync({ id: "i1", patch: { subject: "x" } }); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "invoices"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
  });

  it("also invalidates orders for fromOrder and cancel", async () => {
    Object.assign(client, createFakeSupabase({
      "rpc:werkbank.create_invoice_from_order": { data: "i2", error: null },
      "rpc:werkbank.cancel_invoice": { data: "i3", error: null },
    }));
    const { result, queryClient } = renderHookWithProviders(() => useInvoiceMutations(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.fromOrder.mutateAsync("o1"); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "invoices"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
    spy.mockClear();
    await act(async () => { await result.current.cancel.mutateAsync("i1"); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
  });

  it("toasts the translated database error", async () => {
    Object.assign(client, createFakeSupabase({ "werkbank.invoices": { data: null, error: { code: "55000", message: "invoice_locked" } } }));
    const { result } = renderHookWithProviders(() => useInvoiceMutations(), { authOverrides });
    await act(async () => { await result.current.update.mutateAsync({ id: "i1", patch: { subject: "x" } }).catch(() => undefined); });
    const locked = i18n.t("errors.invoiceLocked", { ns: "werkbank" });
    expect(locked).not.toBe(i18n.t("errors.generic", { ns: "werkbank" }));
    expect(toast.error).toHaveBeenCalledWith(locked);
  });
});

describe("invoice action hooks", () => {
  it("issue refreshes invoices and orders, even after a failure", async () => {
    Object.assign(client, createFakeSupabase({ "fn:werkbank-invoices": { data: null, error: { context: new Response(JSON.stringify({ error: "send_failed", issued: true }), { status: 502 }) } } }));
    const { result, queryClient } = renderHookWithProviders(() => useIssueInvoice(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.mutateAsync({ invoiceId: "i1" }).catch(() => undefined); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "invoices"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "orders"] });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("issue success returns the number", async () => {
    Object.assign(client, createFakeSupabase({ "fn:werkbank-invoices": { data: { ok: true, invoice_no: "RE-0001" }, error: null } }));
    const { result } = renderHookWithProviders(() => useIssueInvoice(), { authOverrides });
    await act(async () => { expect((await result.current.mutateAsync({ invoiceId: "i1" })).invoiceNo).toBe("RE-0001"); });
  });

  it("send refreshes invoices; preview and download resolve their value", async () => {
    Object.assign(client, createFakeSupabase({ "fn:werkbank-invoices": { data: { ok: true, email_sent: true, pdf_base64: "QQ==", url: "https://signed" }, error: null } }));
    const send = renderHookWithProviders(() => useSendInvoice(), { authOverrides });
    const spy = vi.spyOn(send.queryClient, "invalidateQueries");
    await act(async () => { await send.result.current.mutateAsync({ invoiceId: "i1", body: { to: ["a@example.de"], cc: [], message: "" } }); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "invoices"] });
    const preview = renderHookWithProviders(() => usePreviewInvoice(), { authOverrides });
    await act(async () => { expect(await preview.result.current.mutateAsync("i1")).toBe("QQ=="); });
    const dl = renderHookWithProviders(() => useInvoiceDownload(), { authOverrides });
    await act(async () => { expect(await dl.result.current.mutateAsync("i1")).toBe("https://signed"); });
  });
});
