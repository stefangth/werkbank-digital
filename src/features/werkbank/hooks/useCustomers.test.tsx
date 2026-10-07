import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useArchiveCustomer, useCreateCustomer, useCustomer, useCustomers, useDeleteCustomer } from "./useCustomers";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;

const form = {
  kind: "property_manager" as const, company_name: "Muster GmbH", first_name: "", last_name: "",
  street: "Hauptstr. 1", postal_code: "01067", city: "Dresden", country_code: "DE",
  email: "", invoice_email: "", phone: "", vat_id: "", payment_terms_days: "14", notes: "", customer_no: "",
};

function seed(result: { data: unknown; error: unknown }) {
  const fake = createFakeSupabase({ "werkbank.customers": result });
  Object.assign(client, fake);
  return fake;
}

beforeEach(() => vi.clearAllMocks());

describe("useCustomers", () => {
  it("loads the org's customers under the customers key", async () => {
    seed({ data: [{ id: "k1", properties: [{ count: 1 }] }], error: null });
    const { result, queryClient } = renderHookWithProviders(() => useCustomers(), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].property_count).toBe(1);
    expect(queryClient.getQueryData(["werkbank", "customers", "org-1"])).toBeDefined();
  });

  it("does not fetch without an org", () => {
    seed({ data: [], error: null });
    const { result } = renderHookWithProviders(() => useCustomers(), { authOverrides: { currentOrg: null } });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCustomer", () => {
  it("loads one customer under the detail key", async () => {
    seed({ data: { id: "k1" }, error: null });
    const { result, queryClient } = renderHookWithProviders(() => useCustomer("k1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toEqual({ id: "k1" }));
    expect(queryClient.getQueryData(["werkbank", "customers", "detail", "k1"])).toBeDefined();
  });

  it("does not fetch without an id", () => {
    seed({ data: null, error: null });
    const { result } = renderHookWithProviders(() => useCustomer(undefined), { authOverrides });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateCustomer", () => {
  it("returns the created row and invalidates the customers domain", async () => {
    seed({ data: { id: "k1", customer_no: "K-10001" }, error: null });
    const { result, queryClient } = renderHookWithProviders(() => useCreateCustomer(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    let created: { customer_no: string } | undefined;
    await act(async () => {
      created = await result.current.mutateAsync(form);
    });
    expect(created?.customer_no).toBe("K-10001");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "customers"] });
  });

  it("toasts the customer number copy for a duplicate customer_no", async () => {
    seed({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "customers_customer_no_unique"' } });
    const { result } = renderHookWithProviders(() => useCreateCustomer(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync(form).catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalledWith("This customer number is already taken.");
  });
});

describe("useArchiveCustomer", () => {
  it("sends an ISO archived_at, and null to restore", async () => {
    const fake = seed({ data: null, error: null });
    const { result } = renderHookWithProviders(() => useArchiveCustomer(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync({ id: "k1", archived: true });
    });
    await act(async () => {
      await result.current.mutateAsync({ id: "k1", archived: false });
    });
    const updates = fake.calls.filter((c) => c.method === "update").map((c) => c.args[0] as { archived_at: string | null });
    expect(typeof updates[0].archived_at).toBe("string");
    expect(updates[1].archived_at).toBeNull();
  });
});

describe("useDeleteCustomer", () => {
  it("toasts the in-use copy when properties still reference the customer", async () => {
    seed({ data: null, error: { code: "23503", message: "violates foreign key constraint" } });
    const { result } = renderHookWithProviders(() => useDeleteCustomer(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync("k1").catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalledWith("This is still in use. Archive it instead.");
  });
});
