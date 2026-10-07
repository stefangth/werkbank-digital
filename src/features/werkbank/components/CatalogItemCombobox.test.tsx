import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { catalog } = vi.hoisted(() => ({ catalog: { data: [] as unknown[] } }));
vi.mock("../hooks/useCatalog", () => ({ useCatalogItems: () => ({ data: catalog.data }) }));

import { CatalogItemCombobox } from "./CatalogItemCombobox";

const item = (id: string, no: string, name: string, category: string | null, archived = false) => ({
  id, item_no: no, name, category, archived_at: archived ? "2026-02-01T00:00:00Z" : null,
  unit_code: "HUR", labour_price: 50, material_price: 0, vat_rate: 19, description: null,
});

describe("CatalogItemCombobox", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
    catalog.data = [
      item("a1", "A-100", "Heizkörper tauschen", "Heizung"),
      item("a2", "B-200", "Rohr verlegen", "Sanitär"),
      item("a3", "C-300", "Altes Teil", "Sanitär", true),
    ];
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  const open = () => fireEvent.click(screen.getByRole("button"));

  it("lists active items only", async () => {
    renderWithProviders(<CatalogItemCombobox onPick={vi.fn()} />);
    open();
    expect(await screen.findByText("Heizkörper tauschen")).toBeInTheDocument();
    expect(screen.queryByText("Altes Teil")).not.toBeInTheDocument();
  });

  it.each([["b-200", "Rohr verlegen"], ["rohr", "Rohr verlegen"], ["heiz", "Heizkörper tauschen"], ["sanitär", "Rohr verlegen"]])(
    "finds %s by number, name or category",
    async (needle, expected) => {
      renderWithProviders(<CatalogItemCombobox onPick={vi.fn()} />);
      open();
      fireEvent.change(await screen.findByPlaceholderText("Artikel suchen"), { target: { value: needle } });
      expect(screen.getByText(expected)).toBeInTheDocument();
    },
  );

  it("hands the picked item over", async () => {
    const onPick = vi.fn();
    renderWithProviders(<CatalogItemCombobox onPick={onPick} />);
    open();
    fireEvent.click(await screen.findByText("Rohr verlegen"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "a2" }));
  });
});
