import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { techs } = vi.hoisted(() => ({ techs: { data: [] as unknown[] } }));
vi.mock("../hooks/useTechnicians", () => ({ useTechnicians: () => ({ data: techs.data }) }));
vi.mock("@/features/auth/AuthContext", async (orig) => ({
  ...(await orig<typeof import("@/features/auth/AuthContext")>()),
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));

import { TechnicianMultiSelect } from "./TechnicianMultiSelect";

const tech = (id: string, name: string) => ({ id, name, email: null, phone: null, account: "none" });

describe("TechnicianMultiSelect", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
    techs.data = [tech("a", "Anna Alt"), tech("b", "Ben Bauer"), tech("c", "Cem Cetin")];
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows chips for the selected technicians", () => {
    renderWithProviders(<TechnicianMultiSelect value={["a", "b"]} onChange={vi.fn()} />);
    expect(screen.getByText("Anna Alt")).toBeInTheDocument();
    expect(screen.getByText("Ben Bauer")).toBeInTheDocument();
    expect(screen.queryByText("Cem Cetin")).not.toBeInTheDocument();
  });

  it("adds an unselected technician", async () => {
    const onChange = vi.fn();
    renderWithProviders(<TechnicianMultiSelect value={["a"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Cem Cetin"));
    expect(onChange).toHaveBeenCalledWith(["a", "c"]);
  });

  it("removes a selected technician from the list", async () => {
    const onChange = vi.fn();
    renderWithProviders(<TechnicianMultiSelect value={["a", "b"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    const items = await screen.findAllByRole("option");
    fireEvent.click(items.find((i) => i.textContent?.includes("Anna Alt"))!);
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("removes a technician with the chip button", () => {
    const onChange = vi.fn();
    renderWithProviders(<TechnicianMultiSelect value={["a", "b"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Anna Alt/ }));
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("blocks toggles while disabled", async () => {
    const onChange = vi.fn();
    renderWithProviders(<TechnicianMultiSelect value={["a"]} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: /Anna Alt/ }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Cem Cetin"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
