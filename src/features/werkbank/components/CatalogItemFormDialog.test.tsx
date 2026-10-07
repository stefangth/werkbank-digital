import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { create, update } = vi.hoisted(() => ({ create: { mutate: vi.fn() }, update: { mutate: vi.fn() } }));
vi.mock("../hooks/useCatalog", () => ({
  useCreateCatalogItem: () => create,
  useUpdateCatalogItem: () => update,
}));

import { CatalogItemFormDialog } from "./CatalogItemFormDialog";
import type { CatalogItem } from "../data/catalog";

const item: CatalogItem = {
  id: "c1",
  org_id: "org-1",
  item_no: "L-1",
  name: "Heizkörper tauschen",
  description: "inkl. Entsorgung",
  category: "Heizung",
  unit_code: "H87",
  labour_price: 40,
  material_price: 12.5,
  vat_rate: 7,
  net_price: 52.5,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderDialog(props: { item?: CatalogItem | null; onOpenChange?: (o: boolean) => void } = {}) {
  return renderWithProviders(
    <CatalogItemFormDialog open onOpenChange={props.onOpenChange ?? vi.fn()} item={props.item ?? null} />,
    { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } },
  );
}

describe("CatalogItemFormDialog", () => {
  // The provider re-reads the stored language (cleared after every test), so German has to be stored, not only set.
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows the live net total of labour and material", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Lohn"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "12,50" } });
    const total = await screen.findByTestId("net-total");
    expect(total.textContent?.replace(/\s/g, " ")).toBe("52,50 €");
  });

  it("creates an item from the entered values", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "Rohr verlegen" } });
    fireEvent.change(screen.getByLabelText("Lohn"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "12,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(create.mutate.mock.calls[0][0]).toMatchObject({
      name: "Rohr verlegen", labour_price: "40", material_price: "12,50", unit_code: "HUR", vat_rate: "19",
    });
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it("does not submit an invalid form", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib eine Bezeichnung ein")).toBeInTheDocument();
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it("prefills an existing item and updates it", async () => {
    renderDialog({ item });
    expect(screen.getByLabelText("Bezeichnung")).toHaveValue("Heizkörper tauschen");
    expect(screen.getByLabelText("Artikelnummer (optional)")).toHaveValue("L-1");
    expect(screen.getByLabelText("Lohn")).toHaveValue("40,00");
    expect(screen.getByLabelText("Material")).toHaveValue("12,50");
    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "Heizkörper erneuern" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(update.mutate).toHaveBeenCalledTimes(1));
    expect(update.mutate.mock.calls[0][0]).toMatchObject({
      id: "c1",
      form: { name: "Heizkörper erneuern", unit_code: "H87", vat_rate: "7", category: "Heizung", labour_price: "40,00" },
    });
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it("closes after a successful save", async () => {
    const onOpenChange = vi.fn();
    create.mutate.mockImplementation((_form, opts) => opts?.onSuccess?.());
    renderDialog({ onOpenChange });
    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Lohn"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
