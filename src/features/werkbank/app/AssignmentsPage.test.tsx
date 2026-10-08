import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { AssignmentRow } from "../data/technicianApp";

vi.mock("./MobileShell", () => ({ MobileShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("./InstallHint", () => ({ InstallHint: () => null }));
vi.mock("../hooks/useAssignments", () => ({ useAssignments: vi.fn(), useIsTechnicianHere: () => true }));

import { useAssignments } from "../hooks/useAssignments";
import { AssignmentsPage } from "./AssignmentsPage";

const row = (o: Partial<AssignmentRow>): AssignmentRow => ({
  id: "o1", order_no: "A-1", status: "open", scheduled_date: "2026-10-09", scheduled_time: "08:30:00", subject: "Heizung warten",
  customer_name: "Meier GmbH", street: "Hauptstr. 1", postal_code: "10115", city: "Berlin", group_key: "today", ...o,
});
const mockList = (state: object) => vi.mocked(useAssignments).mockReturnValue(state as ReturnType<typeof useAssignments>);
const renderPage = () => renderWithProviders(<MemoryRouter><AssignmentsPage /></MemoryRouter>);

describe("AssignmentsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders groups in order with hints on the 7 and 14 day windows and hides empty ones", () => {
    mockList({ isLoading: false, isError: false, data: [
      row({ id: "d", group_key: "done", status: "done" }), row({ id: "t", group_key: "today" }),
      row({ id: "u", group_key: "upcoming" }), row({ id: "v", group_key: "overdue" }),
    ] });
    renderPage();
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(["Overdue", "Today", "Next 7 days", "Done"]);
    expect(screen.getAllByText(/^Default (7|14) days/)).toHaveLength(2);
  });

  it("shows time, customer, address, subject, status and links to the detail", () => {
    mockList({ isLoading: false, isError: false, data: [row({})] });
    renderPage();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/einsaetze/o1");
    const c = within(link);
    expect(c.getByText("08:30")).toBeInTheDocument();
    expect(c.getByText("Meier GmbH")).toBeInTheDocument();
    expect(c.getByText("Hauptstr. 1, 10115 Berlin")).toBeInTheDocument();
    expect(c.getByText("Heizung warten")).toBeInTheDocument();
    expect(c.getByText("Open")).toBeInTheDocument();
  });

  it("explains an empty list", () => {
    mockList({ isLoading: false, isError: false, data: [] });
    renderPage();
    expect(screen.getByText("No assignments yet")).toBeInTheDocument();
  });

  it("shows an alert on error", () => {
    mockList({ isLoading: false, isError: true, data: undefined });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("The assignments could not be loaded.");
  });
});
