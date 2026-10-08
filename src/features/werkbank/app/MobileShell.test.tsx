import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

const signOut = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "m@example.com" }, currentOrg: { id: "org-1" }, signOut }),
}));
vi.mock("@/hooks/useMyProfile", () => ({ useMyProfile: () => ({ data: { display_name: "Max Monteur" } }) }));
vi.mock("../hooks/useCompanyProfile", () => ({
  useCompanyProfile: () => ({ data: { logo_path: "org-1/logo.png" } }),
  useLogoUrl: () => ({ data: "https://signed.example/logo.png" }),
}));

import { MobileShell } from "./MobileShell";

describe("MobileShell", () => {
  it("shows logo, user name, title and a back link, without a sidebar", () => {
    renderWithProviders(<MemoryRouter><MobileShell title="Einsatz" back="/einsaetze"><p>body</p></MobileShell></MemoryRouter>);
    expect(screen.getByText("Max Monteur")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "https://signed.example/logo.png");
    expect(screen.getByRole("heading", { name: "Einsatz" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/einsaetze");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });
});
