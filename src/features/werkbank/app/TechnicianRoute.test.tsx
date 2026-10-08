import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("../hooks/useAssignments", () => ({ useIsTechnicianHere: vi.fn() }));

import { useIsTechnicianHere } from "../hooks/useAssignments";
import { TechnicianRoute } from "./TechnicianRoute";

describe("TechnicianRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the children for a technician of the active org", () => {
    vi.mocked(useIsTechnicianHere).mockReturnValue(true);
    renderWithProviders(<TechnicianRoute><p>inside</p></TechnicianRoute>);
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("says so when the user is no technician here", () => {
    vi.mocked(useIsTechnicianHere).mockReturnValue(false);
    renderWithProviders(<TechnicianRoute><p>inside</p></TechnicianRoute>);
    expect(screen.getByText("You are not set up as a technician at this company.")).toBeInTheDocument();
    expect(screen.queryByText("inside")).not.toBeInTheDocument();
  });

  it("shows a skeleton while unknown", () => {
    vi.mocked(useIsTechnicianHere).mockReturnValue(undefined);
    renderWithProviders(<TechnicianRoute><p>inside</p></TechnicianRoute>);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("inside")).not.toBeInTheDocument();
  });
});
