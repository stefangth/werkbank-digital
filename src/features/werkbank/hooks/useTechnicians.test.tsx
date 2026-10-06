import { describe, it, expect, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renderHookWithProviders } from "@/test/renderWithProviders";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

import { useCreateTechnician, useTechnicians } from "./useTechnicians";

function seed() {
  Object.assign(
    client,
    createFakeSupabase({
      artists: { data: [{ id: "a1", name: "Anna", email: "a@x.de", phone: null, user_id: "u1" }], error: null },
      "rpc:list_pending_invited_artists": { data: [], error: null },
      "fn:create-invitation": { data: { invitation: { id: "inv-1" } }, error: null },
    }),
  );
}

describe("useTechnicians", () => {
  it("loads the technicians under the technicians query key", async () => {
    seed();
    const { result, queryClient } = renderHookWithProviders(() => useTechnicians("org-1"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["artists", "technicians", "org-1"])).toBeDefined();
  });

  it("does not fetch without an org", () => {
    seed();
    const { result } = renderHookWithProviders(() => useTechnicians(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateTechnician", () => {
  it("invalidates the artists domain after creating", async () => {
    seed();
    const { result, queryClient } = renderHookWithProviders(() => useCreateTechnician("org-1"));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ name: "Dora", email: "d@x.de", phone: null });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["artists"] });
  });
});
