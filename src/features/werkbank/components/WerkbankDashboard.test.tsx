import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { WerkbankDashboard } from "./WerkbankDashboard";

function authAs(role: "admin" | "producer" | "artist") {
  vi.mocked(useAuth).mockReturnValue({ hasRole: (r: string) => r === role } as never);
}

function renderDashboard() {
  return renderWithProviders(
    <MemoryRouter>
      <WerkbankDashboard />
    </MemoryRouter>,
  );
}

describe("WerkbankDashboard", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["admin", "producer"] as const)("shows the title and a technicians CTA for %s", (role) => {
    authAs(role);
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Welcome to Werkbank Digital" })).toBeInTheDocument();
    expect(screen.getByText(/Start by adding your technicians/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add technicians" })).toHaveAttribute("href", "/technicians");
  });

  it("shows the title but no CTA for an artist", () => {
    authAs("artist");
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Welcome to Werkbank Digital" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add technicians" })).not.toBeInTheDocument();
  });
});
