import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";
import type { DocumentItem } from "../data/documentItems";

const { state, mut } = vi.hoisted(() => {
  const m = () => ({ mutate: vi.fn(), isPending: false });
  return {
    state: { items: [] as unknown[], catalog: [] as unknown[] },
    mut: { add: m(), update: m(), remove: m(), reorder: m() },
  };
});
vi.mock("../hooks/useDocumentItems", () => ({
  useDocumentItems: () => ({ data: state.items, isLoading: false }),
  useItemMutations: () => mut,
}));
vi.mock("../hooks/useCatalog", () => ({ useCatalogItems: () => ({ data: state.catalog }) }));
// jsdom cannot drag: the stub exposes the two callbacks the editor wires up.
vi.mock("framer-motion", async (orig) => {
  const actual = await orig<typeof import("framer-motion")>();
  return {
    ...actual,
    Reorder: {
      Group: ({ children, onReorder, values }: { children: React.ReactNode; onReorder: (v: unknown[]) => void; values: unknown[] }) => (
        <div><button onClick={() => onReorder([...values].reverse())}>test-reverse</button>{children}</div>
      ),
      Item: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd?: () => void }) => (
        <div><button onClick={onDragEnd}>test-drop</button>{children}</div>
      ),
    },
  };
});

import { LineItemsEditor } from "./LineItemsEditor";

const row = (over: Partial<DocumentItem>): DocumentItem => ({
  id: "i", kind: "item", name: "Position", description: null, catalog_item_id: null, item_no: null, quantity: 2, unit_code: "HUR",
  labour_price: 50, material_price: 10, vat_rate: 19, line_net: 120, sort_order: 0, org_id: "o", quote_id: "q1", order_id: null, invoice_id: null,
  source_item_id: null, created_at: "", updated_at: "", ...over,
});

describe("LineItemsEditor", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
    state.items = [
      row({ id: "t1", kind: "title", name: "Bad", sort_order: 0, quantity: null, line_net: null }),
      row({ id: "i1", name: "Fliesen", sort_order: 10, line_net: 100 }),
      row({ id: "i2", name: "Silikon", sort_order: 20, line_net: 20.5 }),
      row({ id: "t2", kind: "title", name: "Küche", sort_order: 30, quantity: null, line_net: null }),
    ];
    state.catalog = [{
      id: "c1", item_no: "A-100", name: "Heizkörper", category: null, archived_at: null, description: "Beschreibung",
      unit_code: "H87", labour_price: 80, material_price: 120, vat_rate: 7,
    }];
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it.each([[true], [false]])("marks changed and new lines against the quote (read only: %s)", (readOnly) => {
    renderWithProviders(
      <LineItemsEditor docRef={{ orderId: "o1" }} readOnly={readOnly} marks={{ changed: new Set(["i1"]), added: new Set(["i2"]) }} />,
    );
    const rows = document.querySelectorAll("[data-row]");
    const rowOf = (name: string) => [...rows].find((r) => r.textContent?.includes(name) || [...r.querySelectorAll("input")].some((i) => i.value === name))!;
    expect(rowOf("Fliesen")).toHaveTextContent("Geändert");
    expect(rowOf("Silikon")).toHaveTextContent("Neu");
    expect(rowOf("Bad")).not.toHaveTextContent(/Geändert|Neu/);
  });

  it("adds a catalog item with the snapshot values after the last row", async () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Katalogartikel hinzufügen" }));
    fireEvent.click(await screen.findByText("Heizkörper"));
    expect(mut.add.mutate).toHaveBeenCalledWith({
      draft: {
        kind: "item", name: "Heizkörper", description: "Beschreibung", catalog_item_id: "c1", item_no: "A-100",
        quantity: 1, unit_code: "H87", labour_price: 80, material_price: 120, vat_rate: 7,
      },
      sortOrder: 40,
    });
  });

  it("adds a free item, a title and a text block", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    // The DB requires a non-blank name (item, title) or description (text), so new lines start
    // with a placeholder the user overwrites.
    fireEvent.click(screen.getByRole("button", { name: "Freie Position" }));
    expect(mut.add.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ draft: expect.objectContaining({ kind: "item", catalog_item_id: null, name: "Neue Position" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Titel hinzufügen" }));
    expect(mut.add.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ draft: expect.objectContaining({ kind: "title", name: "Neuer Titel" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Text hinzufügen" }));
    expect(mut.add.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ draft: expect.objectContaining({ kind: "text", name: null, description: "Neuer Text" }) }));
  });

  it("saves a typed quantity once, 500 ms after the last keystroke", () => {
    vi.useFakeTimers();
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const qty = screen.getAllByLabelText("Menge")[0];
    fireEvent.change(qty, { target: { value: "3" } });
    fireEvent.change(qty, { target: { value: "3,5" } });
    act(() => { vi.advanceTimersByTime(499); });
    expect(mut.update.mutate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(mut.update.mutate).toHaveBeenCalledTimes(1);
    expect(mut.update.mutate).toHaveBeenCalledWith({ id: "i1", patch: { quantity: 3.5 } });
  });

  it("flushes a pending edit when the editor unmounts before the debounce", () => {
    vi.useFakeTimers();
    const { unmount } = renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    fireEvent.change(screen.getAllByLabelText("Menge")[0], { target: { value: "4" } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(mut.update.mutate).not.toHaveBeenCalled();
    unmount();
    expect(mut.update.mutate).toHaveBeenCalledTimes(1);
    expect(mut.update.mutate).toHaveBeenCalledWith({ id: "i1", patch: { quantity: 4 } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mut.update.mutate).toHaveBeenCalledTimes(1);
  });

  it("uses decimal keyboards for quantity and prices", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    for (const label of ["Menge", "Lohn", "Material"]) {
      expect(screen.getAllByLabelText(label)[0]).toHaveAttribute("inputmode", "decimal");
    }
  });

  it("saves a price and does not save an invalid one", () => {
    vi.useFakeTimers();
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const labour = screen.getAllByLabelText("Lohn")[0];
    fireEvent.change(labour, { target: { value: "12,5x" } });
    act(() => { vi.advanceTimersByTime(600); });
    expect(mut.update.mutate).not.toHaveBeenCalled();
    fireEvent.change(labour, { target: { value: "12,5" } });
    act(() => { vi.advanceTimersByTime(600); });
    expect(mut.update.mutate).toHaveBeenCalledWith({ id: "i1", patch: { labour_price: 12.5 } });
  });

  it("shows a message for an invalid number and reverts to the saved value on blur", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const labour = screen.getAllByLabelText("Lohn")[0];
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.focus(labour);
    fireEvent.change(labour, { target: { value: "12,5x" } });
    expect(labour).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte gib eine Zahl ein");
    expect(labour).toHaveAccessibleDescription(/Bitte gib eine Zahl ein/);
    fireEvent.blur(labour);
    expect(labour).toHaveValue("50");
    expect(labour).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mut.update.mutate).not.toHaveBeenCalled();
  });

  it("takes a changed server value when the field is not focused, but keeps the focused edit", () => {
    const { rerender } = renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const name = () => screen.getAllByLabelText("Bezeichnung")[0];
    state.items = (state.items as DocumentItem[]).map((i) => (i.id === "i1" ? { ...i, name: "Fliesen neu" } : i));
    rerender(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    expect(name()).toHaveValue("Fliesen neu");
    fireEvent.focus(name());
    fireEvent.change(name(), { target: { value: "Tippe" } });
    state.items = (state.items as DocumentItem[]).map((i) => (i.id === "i1" ? { ...i, name: "Fremd" } : i));
    rerender(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    expect(name()).toHaveValue("Tippe");
  });

  it("adopts an outside change on blur when the focused field was not edited", () => {
    const { rerender } = renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const name = () => screen.getAllByLabelText("Bezeichnung")[0];
    fireEvent.focus(name());
    state.items = (state.items as DocumentItem[]).map((i) => (i.id === "i1" ? { ...i, name: "Fremd" } : i));
    rerender(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    expect(name()).toHaveValue("Fliesen");
    fireEvent.blur(name());
    expect(name()).toHaveValue("Fremd");
  });

  it("formats the read only quantity with the UI language, up to three decimals", async () => {
    state.items = [row({ id: "i1", quantity: 1234.5 }), row({ id: "i2", quantity: 0.125 })];
    const { unmount } = renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly />);
    expect(screen.getByText(/^1\.234,5 /)).toBeInTheDocument();
    expect(screen.getByText(/^0,125 /)).toBeInTheDocument();
    unmount();
    localStorage.setItem(STORAGE_KEY, "en");
    await act(async () => { await i18n.changeLanguage("en"); });
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly />);
    expect(screen.getByText(/^1,234\.5 /)).toBeInTheDocument();
  });

  it("persists the new order on drop", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    fireEvent.click(screen.getByText("test-reverse"));
    fireEvent.click(screen.getAllByText("test-drop")[0]);
    expect(mut.reorder.mutate).toHaveBeenCalledWith(["t2", "i2", "i1", "t1"]);
  });

  it("shows the section subtotal on title rows", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const bad = screen.getByDisplayValue("Bad").closest("[data-row]") as HTMLElement;
    expect(within(bad).getByText(/120,50/)).toBeInTheDocument();
  });

  it("deletes an empty title at once and asks before deleting a title with items", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const kitchen = screen.getByDisplayValue("Küche").closest("[data-row]") as HTMLElement;
    fireEvent.click(within(kitchen).getByRole("button", { name: "Löschen" }));
    expect(mut.remove.mutate).toHaveBeenCalledWith("t2");

    const bad = screen.getByDisplayValue("Bad").closest("[data-row]") as HTMLElement;
    fireEvent.click(within(bad).getByRole("button", { name: "Löschen" }));
    expect(mut.remove.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Löschen" }));
    expect(mut.remove.mutate).toHaveBeenLastCalledWith("t1");
  });

  it("deletes a plain item without asking", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly={false} />);
    const fliesen = screen.getByDisplayValue("Fliesen").closest("[data-row]") as HTMLElement;
    fireEvent.click(within(fliesen).getByRole("button", { name: "Löschen" }));
    expect(mut.remove.mutate).toHaveBeenCalledWith("i1");
  });

  it("renders plain text without inputs or grip when read only", () => {
    renderWithProviders(<LineItemsEditor docRef={{ quoteId: "q1" }} readOnly />);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByLabelText("Verschieben")).not.toBeInTheDocument();
    expect(screen.queryByText("test-drop")).not.toBeInTheDocument();
    expect(screen.getByText("Fliesen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Freie Position" })).not.toBeInTheDocument();
  });
});
