import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useCreateProperty, useDeleteProperty, useProperties, useProperty, usePropertiesForCustomer } from "./useProperties";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;

const form = {
  customer_id: "k1", name: "WEG", object_no: "", street: "Musterstr. 5", postal_code: "01067", city: "Dresden",
  country_code: "DE", has_billing: false, billing_name: "", billing_street: "", billing_postal_code: "",
  billing_city: "", billing_country_code: "", access_notes: "", notes: "",
};

function seed(result: { data: unknown; error: unknown }) {
  const fake = createFakeSupabase({ "werkbank.properties": result });
  Object.assign(client, fake);
  return fake;
}

beforeEach(() => vi.clearAllMocks());

describe("property queries", () => {
  it("loads the org's properties under the properties key", async () => {
    seed({ data: [{ id: "p1" }], error: null });
    const { result, queryClient } = renderHookWithProviders(() => useProperties(), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["werkbank", "properties", "org-1"])).toBeDefined();
  });

  it("loads one property under the detail key", async () => {
    seed({ data: { id: "p1" }, error: null });
    const { result, queryClient } = renderHookWithProviders(() => useProperty("p1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toEqual({ id: "p1" }));
    expect(queryClient.getQueryData(["werkbank", "properties", "detail", "p1"])).toBeDefined();
  });

  it("loads a customer's properties", async () => {
    seed({ data: [{ id: "p1" }], error: null });
    const { result } = renderHookWithProviders(() => usePropertiesForCustomer("k1"), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("does not fetch without an org or id", () => {
    seed({ data: [], error: null });
    expect(renderHookWithProviders(() => useProperties(), { authOverrides: { currentOrg: null } }).result.current.fetchStatus).toBe("idle");
    expect(renderHookWithProviders(() => useProperty(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
  });
});

describe("property mutations", () => {
  it("invalidates properties and customers after a create", async () => {
    seed({ data: { id: "p1" }, error: null });
    const { result, queryClient } = renderHookWithProviders(() => useCreateProperty(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(form);
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "properties"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "customers"] });
  });

  it("toasts the in-use copy when a delete is refused", async () => {
    seed({ data: null, error: { code: "23503", message: "violates foreign key constraint" } });
    const { result } = renderHookWithProviders(() => useDeleteProperty(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync("p1").catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalledWith("This is still in use. Archive it instead.");
  });
});
