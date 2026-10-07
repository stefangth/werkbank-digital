import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useArchiveCatalogItem, useCatalogItems, useCreateCatalogItem } from "./useCatalog";

const authOverrides = { currentOrg: { id: "org-1" } } as unknown as Partial<AuthContextType>;

const form = {
  item_no: "A-1", name: "Heizkörper", description: "", category: "",
  unit_code: "H87" as const, labour_price: "1", material_price: "2", vat_rate: "19" as const,
};

function seed(result: { data: unknown; error: unknown }) {
  const fake = createFakeSupabase({ "werkbank.catalog_items": result });
  Object.assign(client, fake);
  return fake;
}

beforeEach(() => vi.clearAllMocks());

describe("useCatalogItems", () => {
  it("loads the org's items under the catalog key", async () => {
    seed({ data: [{ id: "c1" }], error: null });
    const { result, queryClient } = renderHookWithProviders(() => useCatalogItems(), { authOverrides });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["werkbank", "catalog", "org-1"])).toBeDefined();
  });

  it("does not fetch without an org", () => {
    seed({ data: [], error: null });
    const { result } = renderHookWithProviders(() => useCatalogItems(), { authOverrides: { currentOrg: null } });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateCatalogItem", () => {
  it("invalidates the catalog domain", async () => {
    seed({ data: null, error: null });
    const { result, queryClient } = renderHookWithProviders(() => useCreateCatalogItem(), { authOverrides });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(form);
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["werkbank", "catalog"] });
  });

  it("toasts the item number copy for a duplicate item_no", async () => {
    seed({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "catalog_items_item_no_unique"' } });
    const { result } = renderHookWithProviders(() => useCreateCatalogItem(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync(form).catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalledWith("This item number is already taken.");
  });
});

describe("useArchiveCatalogItem", () => {
  it("sends an ISO archived_at, and null to restore", async () => {
    const fake = seed({ data: null, error: null });
    const { result } = renderHookWithProviders(() => useArchiveCatalogItem(), { authOverrides });
    await act(async () => {
      await result.current.mutateAsync({ id: "c1", archived: true });
    });
    await act(async () => {
      await result.current.mutateAsync({ id: "c1", archived: false });
    });
    const updates = fake.calls.filter((c) => c.method === "update").map((c) => c.args[0] as { archived_at: string | null });
    expect(typeof updates[0].archived_at).toBe("string");
    expect(updates[1].archived_at).toBeNull();
  });
});
