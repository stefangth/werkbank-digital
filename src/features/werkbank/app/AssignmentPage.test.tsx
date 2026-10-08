import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";
import type { AssignmentDetail } from "../data/technicianApp";

vi.mock("./MobileShell", () => ({ MobileShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../hooks/useAssignments", () => ({
  ASSIGNMENTS_KEY: ["werkbank", "assignments"], useAssignment: vi.fn(), useAssignmentActions: vi.fn(), useIsTechnicianHere: () => true,
}));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { useAssignment, useAssignmentActions } from "../hooks/useAssignments";
import { AssignmentPage } from "./AssignmentPage";

const detail = (o: Partial<AssignmentDetail["order"]> = {}, rest: Partial<AssignmentDetail> = {}): AssignmentDetail => ({
  order: {
    id: "o1", org_id: "org", order_no: "A-1", status: "open", scheduled_date: "2026-10-09", scheduled_time: "08:30:00", subject: "Heizung warten",
    customer_name: "Meier GmbH", street: "Hauptstr. 1", postal_code: "10115", city: "Berlin", group_key: "today", location_note: null, notes: null, ...o,
  },
  contact: { name: "Frau Meier", phone: "030 123", mobile: null, email: "m@example.com" },
  items: [{ position: 1, title: "Thermostat", description: "Typ X", quantity: 2, unit: "H87", kind: "item" }],
  technicians: ["Kai"], reports: [], ...rest,
});

const start = { mutate: vi.fn(), isPending: false };
const complete = { mutate: vi.fn(), isPending: false };
const refetch = vi.fn();
function mockQuery(state: object) {
  vi.mocked(useAssignment).mockReturnValue({ isLoading: false, isError: false, refetch, ...state } as unknown as ReturnType<typeof useAssignment>);
}
const renderPage = () => renderWithProviders(
  <MemoryRouter initialEntries={["/einsaetze/o1"]}><Routes><Route path="/einsaetze/:orderId" element={<AssignmentPage />} /></Routes></MemoryRouter>,
  { authOverrides: { user: { id: "u1" }, currentOrg: { id: "org" } } as unknown as Partial<AuthContextType> },
);

describe("AssignmentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAssignmentActions).mockReturnValue({ start, complete } as unknown as ReturnType<typeof useAssignmentActions>);
  });

  it("shows order number, date and status and starts an open order", async () => {
    mockQuery({ data: detail() });
    renderPage();
    expect(screen.getByText("A-1")).toBeInTheDocument();
    expect(screen.getByText(/09\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    expect(start.mutate).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Report as done" })).toBeNull();
  });

  it("asks before reporting an in-progress order as done", async () => {
    mockQuery({ data: detail({ status: "in_progress" }) });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Report as done" }));
    expect(complete.mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Report as done" }));
    expect(complete.mutate).toHaveBeenCalled();
  });

  it("offers no action for a done order", () => {
    mockQuery({ data: detail({ status: "done" }) });
    renderPage();
    expect(screen.queryByRole("button", { name: /Start work|Report as done/ })).toBeNull();
  });

  async function failComplete(err: unknown) {
    mockQuery({ data: detail({ status: "in_progress" }) });
    complete.mutate.mockImplementation((_v, opts) => opts.onError(err));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Report as done" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Report as done" }));
  }

  it("treats invalid_transition as success when the refetch shows done", async () => {
    refetch.mockResolvedValue({ data: detail({ status: "done" }) });
    await failComplete({ code: "22023", message: "invalid_transition" });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("still toasts invalid_transition when the order is not done", async () => {
    refetch.mockResolvedValue({ data: detail({ status: "in_progress" }) });
    await failComplete({ code: "22023", message: "invalid_transition" });
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });

  it("shows the not assigned copy with a link back to the list", () => {
    mockQuery({ data: undefined, isError: true, error: { code: "42501", message: "not_assigned" } });
    renderPage();
    expect(screen.getByText("This order is no longer assigned to you.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to my assignments" })).toHaveAttribute("href", "/einsaetze");
  });

  it("renders contact links, route link, quantity without prices", () => {
    mockQuery({ data: detail() });
    renderPage();
    expect(screen.getByRole("link", { name: /030 123/ })).toHaveAttribute("href", "tel:030 123");
    expect(screen.getByRole("link", { name: /m@example.com/ })).toHaveAttribute("href", "mailto:m@example.com");
    expect(screen.getByRole("link", { name: "Open route" }).getAttribute("href")).toContain("destination=Hauptstr.%201%2C%2010115%20Berlin");
    expect(screen.getByText("Thermostat", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/€|EUR/);
  });

  it("lists reports read-only with their state", () => {
    mockQuery({ data: detail({}, { reports: [{
      id: "r1", artist_id: "a", technician_name: "Kai", visit_date: "2026-10-08", body: "x", locked_at: "t", signer_name: "Frau Meier",
      signature_path: "p", signed_at: "t", is_mine: true, photos: [],
    }] }) });
    renderPage();
    expect(screen.getByText("Signed by Frau Meier")).toBeInTheDocument();
  });
});
