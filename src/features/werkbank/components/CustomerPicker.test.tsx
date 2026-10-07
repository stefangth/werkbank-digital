import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { customers } = vi.hoisted(() => ({ customers: { data: [] as unknown[] } }));
vi.mock("../hooks/useCustomers", () => ({ useCustomers: () => ({ data: customers.data }) }));

import { CustomerPicker } from "./CustomerPicker";

const c = (id: string, no: string, company: string, archived = false) => ({
  id, customer_no: no, kind: "property_manager", company_name: company, first_name: null, last_name: null,
  archived_at: archived ? "2026-02-01T00:00:00Z" : null,
});

describe("CustomerPicker", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
    customers.data = [c("k1", "K-1", "Muster HV"), c("k2", "K-2", "Alte Verwaltung", true), c("k3", "K-3", "Zweite HV")];
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  const open = () => fireEvent.click(screen.getByRole("combobox"));

  it("lists only active customers", async () => {
    renderWithProviders(<CustomerPicker value="" onChange={vi.fn()} />);
    open();
    expect(await screen.findByText("Muster HV")).toBeInTheDocument();
    expect(screen.getByText("Zweite HV")).toBeInTheDocument();
    expect(screen.queryByText(/Alte Verwaltung/)).not.toBeInTheDocument();
  });

  it("keeps the selected archived customer, marked archiviert", async () => {
    renderWithProviders(<CustomerPicker value="k2" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Alte Verwaltung (archiviert)");
    open();
    expect(await screen.findAllByText("Alte Verwaltung (archiviert)")).not.toHaveLength(0);
  });

  it("filters by name and number, and reports the picked customer", async () => {
    const onChange = vi.fn();
    renderWithProviders(<CustomerPicker value="" onChange={onChange} />);
    open();
    fireEvent.change(await screen.findByPlaceholderText("Kunden suchen"), { target: { value: "k-3" } });
    expect(screen.queryByText("Muster HV")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Zweite HV"));
    expect(onChange).toHaveBeenCalledWith("k3");
  });

  it("says so when nothing matches", async () => {
    renderWithProviders(<CustomerPicker value="" onChange={vi.fn()} />);
    open();
    fireEvent.change(await screen.findByPlaceholderText("Kunden suchen"), { target: { value: "zzz" } });
    expect(screen.getByText("Kein Kunde gefunden")).toBeInTheDocument();
  });
});
