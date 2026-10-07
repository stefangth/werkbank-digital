import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { props } = vi.hoisted(() => ({ props: { data: [] as unknown[] } }));
vi.mock("../hooks/useProperties", () => ({ usePropertiesForCustomer: () => ({ data: props.data }) }));

import { PropertyPicker } from "./PropertyPicker";

const p = (id: string, name: string, archived = false) => ({
  id, name, object_no: null, archived_at: archived ? "2026-02-01T00:00:00Z" : null,
});

describe("PropertyPicker", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
    props.data = [p("p1", "Hauptstr. 1"), p("p2", "Alte Str. 2", true)];
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("is disabled without a customer", () => {
    renderWithProviders(<PropertyPicker customerId="" value="" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("is disabled when told so", () => {
    renderWithProviders(<PropertyPicker customerId="k1" value="" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("lists active properties and reports the picked one", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PropertyPicker customerId="k1" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Hauptstr. 1")).toBeInTheDocument();
    expect(screen.queryByText(/Alte Str/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Hauptstr. 1"));
    expect(onChange).toHaveBeenCalledWith("p1");
  });
});
