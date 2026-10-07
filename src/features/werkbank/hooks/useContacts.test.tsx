import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useContacts, useCreateContact, useDeleteContact, useSetPrimaryContact } from "./useContacts";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;
const form = { first_name: "", last_name: "Meier", role: "", phone: "", mobile: "", email: "", notes: "", is_primary: false };

function seed(result: { data: unknown; error: unknown }) {
  const fake = createFakeSupabase({ "werkbank.contacts": result });
  Object.assign(client, fake);
  return fake;
}

beforeEach(() => vi.clearAllMocks());

describe("useContacts", () => {
  it("loads under a customer key and under a property key", async () => {
    seed({ data: [{ id: "c1" }], error: null });
    const a = renderHookWithProviders(() => useContacts({ customerId: "k1" }), { authOverrides });
    await waitFor(() => expect(a.result.current.data).toHaveLength(1));
    expect(a.queryClient.getQueryData(["werkbank", "contacts", "customer", "k1"])).toBeDefined();
    const b = renderHookWithProviders(() => useContacts({ propertyId: "p1" }), { authOverrides });
    await waitFor(() => expect(b.result.current.data).toHaveLength(1));
    expect(b.queryClient.getQueryData(["werkbank", "contacts", "property", "p1"])).toBeDefined();
  });

  it("does not fetch without a parent", () => {
    seed({ data: [], error: null });
    expect(renderHookWithProviders(() => useContacts(undefined), { authOverrides }).result.current.fetchStatus).toBe("idle");
  });
});

describe("contact mutations", () => {
  it("creates under the parent and invalidates the contacts domain", async () => {
    const fake = seed({ data: { id: "c1" }, error: null });
    const { result, queryClient } = renderHookWithProviders(() => useCreateContact(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ parent: { propertyId: "p1" }, form });
    });
    expect(fake.calls.find((c) => c.method === "insert")?.args[0]).toMatchObject({ org_id: "org-1", property_id: "p1", customer_id: null });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "contacts"] });
  });

  it("sets the primary contact", async () => {
    const fake = seed({ data: null, error: null });
    const { result } = renderHookWithProviders(() => useSetPrimaryContact(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync({ parent: { customerId: "k1" }, id: "c1" });
    });
    expect(fake.calls.filter((c) => c.method === "update").map((c) => c.args[0])).toEqual([{ is_primary: false }, { is_primary: true }]);
  });

  it("toasts the database error copy", async () => {
    seed({ data: null, error: { code: "42501", message: "permission denied" } });
    const { result } = renderHookWithProviders(() => useDeleteContact(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync("c1").catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalled();
  });
});
