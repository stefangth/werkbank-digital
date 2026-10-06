import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BRANDS, DEFAULT_BRAND_KEY, type BrandDef } from "@/lib/brand";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const brand = vi.hoisted(() => ({ current: null as BrandDef | null }));
vi.mock("@/hooks/useBrand", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useBrand")>();
  return { ...actual, useBrand: () => brand.current ?? actual.useBrand() };
});

vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Lena Roth", phone: null }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/usePasswordStatus", () => ({
  usePasswordStatus: () => ({ data: false, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: {} }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: null }) }));
vi.mock("@/hooks/useMyBlockedDatesCount", () => ({ useMyBlockedDatesCount: () => ({ data: 0 }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: () => false }));

import ProfilePage from "./ProfilePage";

function renderProfile() {
  return renderWithProviders(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
    {
      authOverrides: {
        user: { id: "u1", email: "lena.roth@posteo.de" } as never,
        roles: ["producer"] as never,
        hasRole: (r: string) => r === "producer",
      },
    },
  );
}

describe("ProfilePage document title", () => {
  it("keeps the Showflow title for the default brand", async () => {
    brand.current = null;
    renderProfile();
    await waitFor(() => expect(document.title).toBe("Profile · ShowFlow"));
    expect(BRANDS[DEFAULT_BRAND_KEY].name).toBe("ShowFlow");
  });

  it("names the current brand", async () => {
    brand.current = { ...BRANDS[DEFAULT_BRAND_KEY], key: "acme", name: "Acme Trades" };
    renderProfile();
    await waitFor(() => expect(document.title).toBe("Profile · Acme Trades"));
  });
});
