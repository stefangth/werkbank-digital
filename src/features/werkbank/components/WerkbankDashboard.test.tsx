import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { WerkbankDashboard } from "./WerkbankDashboard";

function authAs(role: "admin" | "producer" | "artist") {
  vi.mocked(useAuth).mockReturnValue({ hasRole: (r: string) => r === role, currentOrg: { id: "org-1" }, user: { id: "u1" } } as never);
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
        "werkbank.company_profiles": { data: null, error: null },
        "werkbank.invoice_balances": { data: [
          { invoice_id: "i1", days_overdue: 20, open_amount: 100 },
          { invoice_id: "i2", days_overdue: 5, open_amount: 50 },
          { invoice_id: "i3", days_overdue: 40, open_amount: 70 },
        ], error: null },
        "werkbank.dunning_due": { data: [{ invoice_id: "i1" }, { invoice_id: "i3" }], error: null },
        "werkbank.quote_list": { data: [
          { id: "q1", status: "accepted", has_order: false },
          { id: "q2", status: "accepted", has_order: false },
          { id: "q3", status: "accepted", has_order: true },
          { id: "q4", status: "sent", has_order: false },
        ], error: null },
        "werkbank.order_list": { data: [
          { id: "o1", status: "open", scheduled_date: null },
          { id: "o2", status: "in_progress", scheduled_date: null },
          { id: "o3", status: "open", scheduled_date: "2026-11-03" },
          { id: "o4", status: "done", scheduled_date: null, completed_by_technician: true },
          { id: "o6", status: "done", scheduled_date: null, completed_by_technician: false },
          { id: "o7", status: "open", scheduled_date: "2026-11-04", completed_by_technician: true },
          { id: "o5", status: "cancelled", scheduled_date: null },
        ], error: null },
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

  it("redirects a user whose only role is technician to the assignments", () => {
    authAs("artist");
    renderWithProviders(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<WerkbankDashboard />} />
          <Route path="/einsaetze" element={<p>assignments page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("assignments page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome to Werkbank Digital" })).not.toBeInTheDocument();
  });

  it("shows the assignments link for an admin who is a technician", async () => {
    authAs("admin");
    Object.assign(client, createFakeSupabase({
      "rpc:werkbank.my_technician_orgs": { data: ["org-1"], error: null },
    }));
    renderDashboard();
    expect(await screen.findByRole("link", { name: "My assignments" })).toHaveAttribute("href", "/einsaetze");
  });

  it("shows no assignments link for an admin who is not a technician", async () => {
    authAs("admin");
    renderDashboard();
    await screen.findByRole("link", { name: "Add technicians" });
    expect(screen.queryByRole("link", { name: "My assignments" })).not.toBeInTheDocument();
  });

  it.each(["admin", "producer"] as const)("shows the two KPI tiles with counts and filtered links for %s", async (role) => {
    authAs(role);
    renderDashboard();
    const accepted = (await screen.findByRole("link", { name: /Accepted, no order yet/ }));
    expect(accepted).toHaveAttribute("href", "/quotes?status=accepted&noOrder=1");
    await waitFor(() => expect(accepted).toHaveTextContent("2"));
    const unscheduled = screen.getByRole("link", { name: /Orders without a date/ });
    expect(unscheduled).toHaveAttribute("href", "/orders?unscheduled=1");
    await waitFor(() => expect(unscheduled).toHaveTextContent("2"));
  });

  it("counts done orders completed by a technician and links to the filtered list", async () => {
    authAs("admin");
    renderDashboard();
    const tile = await screen.findByRole("link", { name: /Reported by technician/ });
    expect(tile).toHaveAttribute("href", "/orders?status=done&byTechnician=1");
    await waitFor(() => expect(tile).toHaveTextContent("1"));
  });

  it("shows a skeleton while the counts load and no dash placeholder", () => {
    authAs("admin");
    renderDashboard();
    expect(screen.queryByText("–")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(4);
  });

  it("says so when a count cannot be loaded, and still shows the other tile", async () => {
    authAs("admin");
    Object.assign(client, createFakeSupabase({
      "werkbank.quote_list": { data: null, error: { code: "500" } },
      "werkbank.order_list": { data: [{ id: "o1", status: "open", scheduled_date: null }], error: null },
      artists: { data: null, error: null, count: 0 },
      "werkbank.catalog_items": { data: null, error: null, count: 0 },
      "werkbank.customers": { data: null, error: null, count: 0 },
      "werkbank.company_profiles": { data: null, error: null },
    }));
    renderDashboard();
    expect(await screen.findByText("The count could not be loaded.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: /Orders without a date/ })).toHaveTextContent("1"));
    expect(screen.queryByText("–")).not.toBeInTheDocument();
  });

  it("shows the overdue tile with the count, the notice caption and a link to the open items", async () => {
    authAs("admin");
    renderDashboard();
    const tile = await screen.findByRole("link", { name: /Overdue/ });
    expect(tile).toHaveAttribute("href", "/open-items");
    await waitFor(() => expect(tile).toHaveTextContent("3"));
    expect(tile).toHaveTextContent("of which 2 due a notice");
  });

  it("shows no tiles for a technician", () => {
    authAs("artist");
    renderDashboard();
    expect(screen.queryByRole("link", { name: /Accepted, no order yet/ })).not.toBeInTheDocument();
  });
});
