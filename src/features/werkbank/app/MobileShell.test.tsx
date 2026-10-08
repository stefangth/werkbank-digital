import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));
const signOut = vi.fn(async () => { calls.push("signOut"); });
vi.mock("../lib/idbPersister", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/idbPersister")>()),
  clearAssignmentCache: vi.fn(async (userId: string) => { await Promise.resolve(); calls.push(`clear:${userId}`); }),
}));
vi.mock("./signatureStore", () => ({ clearUploadedSignatures: vi.fn(() => { calls.push("signatures"); }) }));
vi.mock("./registerServiceWorker", () => ({ registerServiceWorker: vi.fn() }));
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
  });

  it("signing out first deletes the offline cache, the cached queries and stored signatures", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(["werkbank"], { gcTime: Infinity });
    queryClient.setQueryData(["werkbank", "assignments", "u1", "org-1"], [{ id: "o1" }]);
    queryClient.setQueryData(["werkbank", "orders", "org-1"], []);
    signOut.mockImplementationOnce(async () => {
      calls.push(`signOut:${queryClient.getQueryCache().findAll({ queryKey: ["werkbank"] }).length}`);
    });
    renderWithProviders(<MemoryRouter><MobileShell title="Einsatz"><p>body</p></MobileShell></MemoryRouter>, { queryClient });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(calls).toEqual(["clear:u1", "signatures", "signOut:0"]);
  });
});
