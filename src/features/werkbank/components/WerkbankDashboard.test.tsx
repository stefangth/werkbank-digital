import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { WerkbankDashboard } from "./WerkbankDashboard";

function authAs(role: "admin" | "producer" | "artist") {
  vi.mocked(useAuth).mockReturnValue({ hasRole: (r: string) => r === role, currentOrg: { id: "org-1" } } as never);
}

function renderDashboard() {
  return renderWithProviders(
    <MemoryRouter>
      <WerkbankDashboard />
    </MemoryRouter>,
  );
}

describe("WerkbankDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(
      client,
      createFakeSupabase({
        artists: { data: null, error: null, count: 2 },
        "werkbank.catalog_items": { data: null, error: null, count: 0 },
        "werkbank.customers": { data: null, error: null, count: 0 },
      }),
    );
  });

  it.each(["admin", "producer"] as const)("shows the welcome and the start list for %s", async (role) => {
    authAs(role);
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Welcome to Werkbank Digital" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Add technicians" })).toHaveAttribute("href", "/technicians");
    expect(screen.getByRole("link", { name: "Add or import services" })).toHaveAttribute("href", "/catalog");
    expect(screen.getByRole("link", { name: "Add or import customers" })).toHaveAttribute("href", "/customers");
  });

  it("shows only the welcome for a technician and reads no counts", () => {
    authAs("artist");
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Welcome to Werkbank Digital" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add technicians" })).not.toBeInTheDocument();
    expect((client as unknown as ReturnType<typeof createFakeSupabase>).calls).toEqual([]);
  });
});
