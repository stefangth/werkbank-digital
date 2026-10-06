import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

// DashboardPage always renders and never redirects — the Get running landing
// decision moved to features/auth/HomeLanding.tsx (mounted at '/'), so clicking
// "Today" can never bounce the user onto the board. These tests just prove the
// artist vs. non-artist branch; the two boards are stubbed with probes.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/dashboard/ArtistDashboard", () => ({
  ArtistDashboard: () => <div>artist dashboard probe</div>,
}));
vi.mock("@/components/today/TodayPage", () => ({
  default: () => <div>today board probe</div>,
}));

// MODULE_UIS is empty in core; the module dashboard path is exercised through a mock.
vi.mock("@/modules/ui", () => ({
  MODULE_UIS: [{ navItems: [], routes: [], dashboards: { test_kind: () => <div>module dashboard probe</div> } }],
}));
vi.mock("@/hooks/useOrgKind", () => ({ useOrgKind: vi.fn(() => "production") }));

import { useAuth } from "@/features/auth/AuthContext";
import { useOrgKind } from "@/hooks/useOrgKind";
import DashboardPage from "./DashboardPage";

function authAs(role: "producer" | "admin" | "artist") {
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === role,
  } as never);
}

function renderPage() {
  return renderWithProviders(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage (always renders, never redirects)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOrgKind).mockReturnValue("production");
  });

  it("renders the Autopilot Today board for a producer", () => {
    authAs("producer");
    renderPage();
    expect(screen.getByText("today board probe")).toBeInTheDocument();
  });

  it("renders the Autopilot Today board for an admin", () => {
    authAs("admin");
    renderPage();
    expect(screen.getByText("today board probe")).toBeInTheDocument();
  });

  it("renders the artist dashboard for an artist-only viewer", () => {
    authAs("artist");
    renderPage();
    expect(screen.getByText("artist dashboard probe")).toBeInTheDocument();
    expect(screen.queryByText("today board probe")).not.toBeInTheDocument();
  });

  it("renders the module dashboard for a kind that contributes one", () => {
    authAs("producer");
    vi.mocked(useOrgKind).mockReturnValue("test_kind" as never);
    renderPage();
    expect(screen.getByText("module dashboard probe")).toBeInTheDocument();
    expect(screen.queryByText("today board probe")).not.toBeInTheDocument();
  });

  it("renders the module dashboard even for an artist-only viewer of that kind", () => {
    authAs("artist");
    vi.mocked(useOrgKind).mockReturnValue("test_kind" as never);
    renderPage();
    expect(screen.getByText("module dashboard probe")).toBeInTheDocument();
    expect(screen.queryByText("artist dashboard probe")).not.toBeInTheDocument();
  });

  it("falls back to today's logic for a kind without a module dashboard", () => {
    authAs("producer");
    vi.mocked(useOrgKind).mockReturnValue("staffing");
    renderPage();
    expect(screen.getByText("today board probe")).toBeInTheDocument();
  });
});
