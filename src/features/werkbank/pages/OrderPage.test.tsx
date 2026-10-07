import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, mut, refetch, route, navigate } = vi.hoisted(() => {
  const m = () => ({ mutate: vi.fn(), isPending: false });
  return {
    state: { order: null as unknown, list: [] as unknown[], quote: null as unknown, orderItems: [] as unknown[], quoteItems: [] as unknown[] },
    mut: { update: m(), setStatus: m(), setTechnicians: m(), remove: m(), create: m(), createFromQuote: m() },
    refetch: vi.fn(),
    route: { id: "o1" },
    navigate: vi.fn(),
  };
});
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useParams: () => ({ id: route.id }),
  useNavigate: () => navigate,
}));
vi.mock("../hooks/useOrders", () => ({
  useOrder: () => ({ data: state.order, isLoading: false, isError: false, refetch }),
  useOrderList: () => ({ data: state.list }),
  useOrderMutations: () => mut,
}));
vi.mock("../hooks/useQuotes", () => ({ useQuote: (id?: string) => ({ data: id ? state.quote : undefined }) }));
vi.mock("../hooks/useDocumentItems", () => ({
  useDocumentItems: (ref?: { quoteId?: string }) => ({ data: ref?.quoteId ? state.quoteItems : state.orderItems }),
}));
vi.mock("../hooks/useCustomers", () => ({ useCustomer: () => ({ data: { id: "k1", kind: "property_manager" } }) }));
vi.mock("../components/LineItemsEditor", () => ({
  LineItemsEditor: ({ readOnly, marks, onLocked }: { readOnly: boolean; marks?: { changed: Set<string>; added: Set<string> }; onLocked?: () => void }) => (
    <div data-testid="items" data-readonly={String(readOnly)} data-changed={[...(marks?.changed ?? [])].join()} data-added={[...(marks?.added ?? [])].join()}>
      <button onClick={onLocked}>test-item-locked</button>
    </div>
  ),
}));
vi.mock("../components/DocumentTotalsCard", () => ({ DocumentTotalsCard: () => <div data-testid="totals" /> }));
vi.mock("../components/CustomerPicker", () => ({ CustomerPicker: () => <div /> }));
vi.mock("../components/PropertyPicker", () => ({ PropertyPicker: () => <div /> }));
vi.mock("../components/ContactSelect", () => ({ ContactSelect: () => <div /> }));
vi.mock("../components/TechnicianMultiSelect", () => ({
  TechnicianMultiSelect: ({ onChange, disabled }: { onChange: (ids: string[]) => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={() => onChange(["a2"])}>test-set-technician</button>
  ),
}));
vi.mock("../components/DatePopover", () => ({
  DatePopover: ({ onSelect, children }: { onSelect: (d: string) => void; children: React.ReactNode }) => (
    <div>{children}<button onClick={() => onSelect("2026-11-02")}>test-pick-date</button></div>
  ),
}));

import { OrderPage } from "./OrderPage";

const order = (over: Record<string, unknown> = {}) => ({
  id: "o1", org_id: "org-1", order_no: "AU-0007", status: "open", quote_id: null, customer_id: "k1", property_id: null, contact_id: null,
  location_note: null, subject: "Heizung", discount_percent: 0, notes: "Schlüssel beim Nachbarn", scheduled_date: null, scheduled_time: null,
  technician_ids: [], technician_names: [], totals: { gross_total: 142.8 }, ...over,
});
const item = (over: Record<string, unknown>) => ({ id: "i", kind: "item", name: "Position", quantity: 1, labour_price: 10, material_price: 0, source_item_id: null, ...over });

describe("OrderPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    route.id = "o1";
    state.order = order();
    state.list = [{ id: "o1", customer_name: "Muster HV", property_name: null, technician_names: ["Anna Berg"] }];
    state.quote = null;
    state.orderItems = [];
    state.quoteItems = [];
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = () =>
    renderWithProviders(<MemoryRouter><OrderPage /></MemoryRouter>, {
      authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never },
    });

  it("shows an editable header, schedule and editor for an open order, and no page mini", async () => {
    render();
    expect(await screen.findByRole("textbox", { name: "Betreff" })).toBeEnabled();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "false");
    expect(screen.getByText("AU-0007")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /So funktionieren/ })).not.toBeInTheDocument();
  });

  it("saves a changed text field on blur and the notes", async () => {
    render();
    const subject = await screen.findByRole("textbox", { name: "Betreff" });
    fireEvent.change(subject, { target: { value: "Bad" } });
    fireEvent.blur(subject);
    expect(mut.update.mutate).toHaveBeenCalledWith({ id: "o1", patch: { subject: "Bad" } }, expect.anything());
    const notes = screen.getByRole("textbox", { name: "Notizen" });
    fireEvent.change(notes, { target: { value: "Neu" } });
    fireEvent.blur(notes);
    expect(mut.update.mutate).toHaveBeenCalledWith({ id: "o1", patch: { notes: "Neu" } }, expect.anything());
  });

  it("saves date, time and technicians; the time needs a date", async () => {
    render();
    expect(await screen.findByLabelText("Uhrzeit")).toBeDisabled();
    fireEvent.click(screen.getByText("test-pick-date"));
    expect(mut.update.mutate).toHaveBeenCalledWith({ id: "o1", patch: { scheduled_date: "2026-11-02" } }, expect.anything());
    fireEvent.click(screen.getByText("test-set-technician"));
    expect(mut.setTechnicians.mutate).toHaveBeenCalledWith({ orderId: "o1", artistIds: ["a2"] }, expect.anything());
  });

  it("is read only when done or cancelled and offers Wieder öffnen only for done", async () => {
    state.order = order({ status: "done" });
    const { unmount } = render();
    expect(await screen.findByTestId("items")).toHaveAttribute("data-readonly", "true");
    expect(screen.queryByRole("textbox", { name: "Betreff" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Uhrzeit")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wieder öffnen" })).toBeInTheDocument();
    unmount();
    state.order = order({ status: "cancelled" });
    render();
    expect(await screen.findByTestId("items")).toHaveAttribute("data-readonly", "true");
    expect(screen.queryByRole("button", { name: /Beginnen|Erledigt|Wieder öffnen|Stornieren/ })).not.toBeInTheDocument();
  });

  it.each([
    ["open", ["Beginnen", "Stornieren"], "Beginnen", "in_progress"],
    ["in_progress", ["Erledigt", "Stornieren"], "Erledigt", "done"],
    ["done", ["Wieder öffnen"], "Wieder öffnen", "in_progress"],
  ])("status %s offers %j and %s sets %s", async (status, labels, click, target) => {
    state.order = order({ status });
    render();
    for (const l of labels) expect(await screen.findByRole("button", { name: l })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: click }));
    expect(mut.setStatus.mutate).toHaveBeenCalledWith({ id: "o1", status: target });
  });

  it("cancels only after confirming", async () => {
    state.order = order({ status: "in_progress" });
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Stornieren" }));
    expect(mut.setStatus.mutate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Auftrag behalten" }));
    expect(mut.setStatus.mutate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Stornieren" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Stornieren" }));
    expect(mut.setStatus.mutate).toHaveBeenCalledWith({ id: "o1", status: "cancelled" });
  });

  it("shows no comparison for a direct order", async () => {
    render();
    await screen.findByTestId("items");
    expect(screen.queryByTestId("comparison-line")).not.toBeInTheDocument();
  });

  it("compares with the quote and marks changed and added lines", async () => {
    state.order = order({ quote_id: "q1" });
    state.quote = { id: "q1", quote_no: "A-0042", version: 2, totals: { gross_total: 119 } };
    state.quoteItems = [item({ id: "q-a" }), item({ id: "q-b" })];
    state.orderItems = [item({ id: "o-a", source_item_id: "q-a", quantity: 3 }), item({ id: "o-n", name: "Anfahrt" })];
    render();
    const line = await screen.findByTestId("comparison-line");
    expect(line).toHaveTextContent("A-0042-2");
    expect(line).toHaveTextContent("119,00");
    expect(line).toHaveTextContent("142,80");
    expect(line).toHaveTextContent("+23,80");
    const items = screen.getByTestId("items");
    expect(items).toHaveAttribute("data-changed", "o-a");
    expect(items).toHaveAttribute("data-added", "o-n");
    expect(screen.getByRole("link", { name: /A-0042-2/ })).toHaveAttribute("href", "/quotes/q1");
  });

  it("turns read only when a save finds the order closed, and resets for the next order", async () => {
    const { unmount } = render();
    fireEvent.click(await screen.findByText("test-item-locked"));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByText("Dieser Auftrag ist abgeschlossen und kann nicht geändert werden.")).toBeInTheDocument();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "true");
    unmount();
    render();
    expect(await screen.findByTestId("items")).toHaveAttribute("data-readonly", "false");
  });

  it("locks on an update error from the database", async () => {
    render();
    const subject = await screen.findByRole("textbox", { name: "Betreff" });
    fireEvent.change(subject, { target: { value: "Bad" } });
    fireEvent.blur(subject);
    const opts = mut.update.mutate.mock.calls[0][1] as { onError: (e: unknown) => void };
    act(() => opts.onError({ code: "P0001", message: "order_locked" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "true");
  });

  it("drops the lock when a closed order is reopened", async () => {
    const view = render();
    fireEvent.click(await screen.findByText("test-item-locked"));
    state.order = order({ status: "done" });
    view.rerender(<MemoryRouter><OrderPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Wieder öffnen" }));
    state.order = order({ status: "in_progress" });
    view.rerender(<MemoryRouter><OrderPage /></MemoryRouter>);
    expect(await screen.findByTestId("items")).toHaveAttribute("data-readonly", "false");
    expect(screen.queryByText("Dieser Auftrag ist abgeschlossen und kann nicht geändert werden.")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Betreff" })).toBeEnabled();
  });

  it("locks on a technician save that finds the order closed", async () => {
    render();
    fireEvent.click(await screen.findByText("test-set-technician"));
    const opts = mut.setTechnicians.mutate.mock.calls[0][1] as { onError: (e: unknown) => void };
    act(() => opts.onError({ code: "P0001", message: "order_locked" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "true");
  });

  it("disables the technicians while a technician save is pending", async () => {
    mut.setTechnicians.isPending = true;
    try {
      render();
      expect(await screen.findByText("test-set-technician")).toBeDisabled();
    } finally {
      mut.setTechnicians.isPending = false;
    }
  });

  it("shows the technician names of the order itself, not of the list", async () => {
    state.order = order({ status: "done", technician_ids: ["a1"], technician_names: ["Anna Berg"] });
    state.list = [];
    render();
    expect(await screen.findByText("Anna Berg")).toBeInTheDocument();
  });

  it("shows no not-found state while the delete is still settling", async () => {
    state.order = null;
    mut.remove.isPending = true;
    try {
      render();
      expect(screen.queryByText("Auftrag nicht gefunden")).not.toBeInTheDocument();
    } finally {
      mut.remove.isPending = false;
    }
    render();
    expect(await screen.findByText("Auftrag nicht gefunden")).toBeInTheDocument();
  });

  it("deletes an open order only after confirming, then goes to the order list", async () => {
    mut.remove.mutate.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Auftrag löschen" }));
    expect(mut.remove.mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("AU-0007");
    fireEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));
    expect(mut.remove.mutate).toHaveBeenCalledWith("o1", expect.anything());
    expect(navigate).toHaveBeenCalledWith("/orders");
  });

  it.each(["in_progress", "done", "cancelled"])("offers no delete for a %s order", async (status) => {
    state.order = order({ status });
    render();
    await screen.findByTestId("items");
    expect(screen.queryByRole("button", { name: "Auftrag löschen" })).not.toBeInTheDocument();
  });
});
