import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CatalogPage } from "./CatalogPage";

const row = (over: Record<string, unknown>) => ({
  org_id: "org-1",
  item_no: null,
  description: null,
  category: null,
  unit_code: "HUR",
  labour_price: 0,
  material_price: 0,
  vat_rate: 19,
  net_price: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const items = [
  row({ id: "c1", item_no: "L-1", name: "Heizkörper tauschen", description: "inkl. Entsorgung", category: "Heizung", unit_code: "H87", labour_price: 40, material_price: 12.5, net_price: 52.5, vat_rate: 7 }),
  row({ id: "c2", item_no: "L-2", name: "Rohr verlegen", category: "Sanitär", unit_code: "MTR", labour_price: 18, material_price: 4, net_price: 22 }),
  row({ id: "c3", item_no: "L-3", name: "Altes Angebot", category: "Heizung", archived_at: "2026-02-01T00:00:00Z" }),
];

function seed(data: unknown[] | null = items, error: unknown = null) {
  Object.assign(client, createFakeSupabase({ "werkbank.catalog_items": { data: error ? null : data, error } }));
}

function renderPage(hasRole: (r: string) => boolean = () => true) {
  return renderWithProviders(<CatalogPage />, {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: hasRole as never },
  });
}

const nbsp = (s: string | null) => (s ?? "").replace(/\s/g, " ");

describe("CatalogPage", () => {
  // The provider re-reads the stored language (cleared after every test), so German has to be stored, not only set.
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows the page mini above the list", async () => {
    seed();
    renderPage();
    expect(await screen.findByRole("region", { name: "So funktionieren Leistungen" })).toBeInTheDocument();
  });

  it("renders the columns and a formatted row", async () => {
    seed();
    renderPage();
    const cell = await screen.findByText("Heizkörper tauschen");
    for (const name of ["Nr.", "Name", "Kategorie", "Einheit", "Lohn", "Material", "Netto", "MwSt."]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    const r = within(cell.closest("tr") as HTMLElement);
    expect(r.getByText("L-1")).toBeInTheDocument();
    expect(r.getByText("Heizung")).toBeInTheDocument();
    expect(r.getByText("Stk")).toBeInTheDocument();
    expect(nbsp(r.getByText(/^40,00\s€$/).textContent)).toBe("40,00 €");
    expect(r.getByText(/^12,50\s€$/)).toBeInTheDocument();
    expect(r.getByText(/^52,50\s€$/)).toBeInTheDocument();
    expect(r.getByText("7 %")).toBeInTheDocument();
  });

  it("searches number, name and description", async () => {
    seed();
    renderPage();
    await screen.findByText("Heizkörper tauschen");
    const search = screen.getByRole("searchbox", { name: "Leistungen durchsuchen" });
    fireEvent.change(search, { target: { value: "entsorgung" } });
    expect(screen.getByText("Heizkörper tauschen")).toBeInTheDocument();
    expect(screen.queryByText("Rohr verlegen")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "l-2" } });
    expect(screen.getByText("Rohr verlegen")).toBeInTheDocument();
    expect(screen.queryByText("Heizkörper tauschen")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "rohr" } });
    expect(screen.getByText("Rohr verlegen")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "gibtesnicht" } });
    expect(screen.getByText("Keine Leistung passt zu deiner Suche.")).toBeInTheDocument();
  });

  it("filters by the distinct categories", async () => {
    seed();
    renderPage();
    await screen.findByText("Heizkörper tauschen");
    fireEvent.click(screen.getByRole("combobox", { name: "Kategorie" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    // Distinct, sorted; the archived item's "Heizung" does not add a duplicate.
    expect(options).toEqual(["Alle Kategorien", "Heizung", "Sanitär"]);
    fireEvent.click(screen.getByRole("option", { name: "Sanitär" }));
    await waitFor(() => expect(screen.queryByText("Heizkörper tauschen")).not.toBeInTheDocument());
    expect(screen.getByText("Rohr verlegen")).toBeInTheDocument();
  });

  it("hides archived items until the switch is on", async () => {
    seed();
    renderPage();
    await screen.findByText("Heizkörper tauschen");
    expect(screen.queryByText("Altes Angebot")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Archivierte anzeigen" }));
    expect(screen.getByText("Altes Angebot")).toBeInTheDocument();
    expect(screen.getByText("Archiviert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederherstellen" })).toBeInTheDocument();
  });

  it("shows the empty state with the create action", async () => {
    seed([]);
    renderPage();
    expect(await screen.findByText("Noch keine Leistungen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erste Leistung anlegen" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Leistung anlegen", { selector: "h2" })).toBeInTheDocument();
  });

  it("offers delete only to an admin", async () => {
    seed();
    const { unmount } = renderPage((r) => r === "admin");
    await screen.findByText("Heizkörper tauschen");
    expect(screen.getAllByRole("button", { name: "Löschen" }).length).toBeGreaterThan(0);
    unmount();
    seed();
    renderPage((r) => r === "producer");
    await screen.findByText("Heizkörper tauschen");
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Bearbeiten" }).length).toBeGreaterThan(0);
  });

  it("confirms before deleting", async () => {
    seed();
    renderPage((r) => r === "admin");
    const cell = await screen.findByText("Rohr verlegen");
    fireEvent.click(within(cell.closest("tr") as HTMLElement).getByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Rohr verlegen/)).toBeInTheDocument();
  });

  it("opens the edit dialog prefilled", async () => {
    seed();
    renderPage();
    const cell = await screen.findByText("Rohr verlegen");
    fireEvent.click(within(cell.closest("tr") as HTMLElement).getByRole("button", { name: "Bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Bezeichnung")).toHaveValue("Rohr verlegen");
  });

  it("opens the import dialog from the header action", async () => {
    seed();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Importieren" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Leistungen importieren")).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    Object.assign(client, createFakeSupabase({ "werkbank.catalog_items": { data: items, error: null } }));
    const { container } = renderPage();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows an alert when loading fails", async () => {
    seed(null, { message: "boom", code: "XX000" });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Deine Leistungen konnten nicht geladen werden");
  });
});
