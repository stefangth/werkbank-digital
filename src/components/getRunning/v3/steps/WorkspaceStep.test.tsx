import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// ESM exports cannot be spied on, so mock the module: "staffing" reports locked when h.lockStaffing is set, and every other module kind is locked.
vi.mock("@/lib/orgKind", async (orig) => ({
  ...(await orig<typeof import("@/lib/orgKind")>()),
  isSwitchableByOrgAdmin: (k: string) => k === "production" || (k === "staffing" && !h.lockStaffing),
}));

const setOrgKind = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/orgs", async (orig) => ({ ...(await orig<typeof import("@/data/orgs")>()), setOrgKind: (...a: unknown[]) => setOrgKind(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const h = vi.hoisted(() => ({ admin: true, lockStaffing: false, kind: "production" }));
vi.mock("@/features/auth/AuthContext", async (orig) => ({
  ...(await orig<typeof import("@/features/auth/AuthContext")>()),
  useAuth: () => ({
    currentOrg: { id: "org-1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: h.kind, org_kind_set_at: null },
    refreshOrgs: () => Promise.resolve(),
    hasRole: (r: string) => (h.admin ? true : r === "producer"),
  }),
}));

import { WorkspaceStep } from "./WorkspaceStep";

describe("WorkspaceStep", () => {
  beforeEach(() => { vi.clearAllMocks(); h.admin = true; h.lockStaffing = false; h.kind = "production"; });

  it("preselects the org's kind, saves the pick and calls onDone", async () => {
    const onDone = vi.fn();
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={onDone} />);
    expect(screen.getByRole("radio", { name: /live production/i })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /staffing agency/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(setOrgKind).toHaveBeenCalledWith(expect.anything(), "org-1", "staffing"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("saves the default too, so the step counts as decided", async () => {
    const onDone = vi.fn();
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(setOrgKind).toHaveBeenCalledWith(expect.anything(), "org-1", "production"));
  });

  it("is read-only for a producer", () => {
    h.admin = false;
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={() => {}} />);
    expect(screen.getByRole("radio", { name: /live production/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask an admin/i)).toBeInTheDocument();
  });

  it("renders cards only for kinds an org admin may switch to", () => {
    h.lockStaffing = true;
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /live production/i })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /staffing agency/i })).not.toBeInTheDocument();
  });

  it("shows a locked current kind as one checked, disabled card and Continue saves nothing", () => {
    h.lockStaffing = true;
    h.kind = "staffing";
    const onDone = vi.fn();
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={onDone} />);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    const card = screen.getByRole("radio", { name: /staffing agency/i });
    expect(card).toBeChecked();
    expect(card).toBeDisabled();
    expect(screen.queryByRole("radio", { name: /live production/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onDone).toHaveBeenCalled();
    expect(setOrgKind).not.toHaveBeenCalled();
  });
});
