import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrgKindSelect } from "./OrgKindSelect";

// ESM exports cannot be spied on, so mock the module: "staffing" reports locked here.
vi.mock("@/lib/orgKind", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orgKind")>()),
  isSwitchableByOrgAdmin: (k: string) => k !== "staffing",
}));

describe("OrgKindSelect", () => {
  it("shows the current kind's title and lists both kinds with descriptions", async () => {
    const onChange = vi.fn();
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={onChange} includeLocked />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Live production");
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /staffing agency/i })).toBeInTheDocument();
    expect(screen.getByText(/clients, shifts, staff and teams/i)).toBeInTheDocument();
  });

  it("calls onChange with the picked kind", async () => {
    const onChange = vi.fn();
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={onChange} includeLocked />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));
    expect(onChange).toHaveBeenCalledWith("staffing");
  });

  it("is disabled when told so", () => {
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={() => {}} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("hides locked kinds from the options by default", async () => {
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox"));
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Live production");
  });

  it("lists locked kinds too when includeLocked is set", async () => {
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={() => {}} includeLocked />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findAllByRole("option")).toHaveLength(2);
  });

  it("renders a locked current value disabled without includeLocked", () => {
    renderWithProviders(<OrgKindSelect id="k" value="staffing" onChange={() => {}} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Staffing agency");
  });

  it("keeps a locked current value enabled with includeLocked", () => {
    renderWithProviders(<OrgKindSelect id="k" value="staffing" onChange={() => {}} includeLocked />);
    expect(screen.getByRole("combobox")).toBeEnabled();
  });
});
