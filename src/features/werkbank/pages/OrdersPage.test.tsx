import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, navigate, create, pick } = vi.hoisted(() => ({
  state: { rows: [] as unknown[], loading: false, error: false },
  navigate: vi.fn(),
  create: vi.fn(),
  pick: { from: "2026-11-02", to: "2026-11-05" },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../hooks/useOrders", () => ({
  useOrderList: () => ({ data: state.rows, isLoading: state.loading, isError: state.error }),
  useOrderMutations: () => ({ create: { mutate: create, isPending: false } }),
}));
vi.mock("../hooks/useTechnicians", () => ({
  useTechnicians: () => ({ data: [{ id: "a1", name: "Anna Berg" }, { id: "a2", name: "Ben Roth" }] }),
}));
vi.mock("../components/CustomerPicker", () => ({
  CustomerPicker: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange("k1")}>test-pick-customer</button>,
}));
// The popover trigger is the real button; the mock adds one that picks a fixed day.
vi.mock("../components/DatePopover", () => ({
  DatePopover: ({ onSelect, children }: { onSelect: (d: string) => void; children: React.ReactNode }) => {
    const which = (children as React.ReactElement<{ id?: string }>).props.id === "orders-from" ? "from" : "to";
    return <div>{children}<button onClick={() => onSelect(pick[which])}>test-pick</button></div>;
  },
}));

import { OrdersPage } from "./OrdersPage";
import { orderPath } from "../paths";

const o = (over: Record<string, unknown>) => ({
  id: "o", order_no: "AU-0001", status: "open", customer_id: "k1", customer_name: "Muster HV", property_name: null, subject: "Heizung",
  scheduled_date: null, scheduled_time: null, technician_ids: [], technician_names: [], net_total: 100, gross_total: 119,
  created_at: "2026-01-01T00:00:00Z", ...over,
});

describe("OrdersPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.loading = false; state.error = false;
    state.rows = [
      o({ id: "o1", order_no: "AU-0001", status: "open", subject: "Heizung warten" }),
      o({ id: "o2", order_no: "AU-0002", status: "in_progress", scheduled_date: "2026-11-03", scheduled_time: "08:30:00", technician_ids: ["a1"], technician_names: ["Anna Berg"], customer_name: "Meier, Anna", property_name: "Hauptstr. 1" }),
      o({ id: "o3", order_no: "AU-0003", status: "done", scheduled_date: "2026-11-10", technician_ids: ["a2"], technician_names: ["Ben Roth"] }),
      o({ id: "o4", order_no: "AU-0004", status: "cancelled", scheduled_date: "2026-11-05", technician_ids: ["a1", "a2"], technician_names: ["Anna Berg", "Ben Roth"] }),
    ];
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = () =>
    renderWithProviders(<OrdersPage />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never } });
  const numbersShown = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

  it("lists orders with their numbers and shows the page mini", async () => {
    render();
    expect(await screen.findByRole("region", { name: "So funktionieren Aufträge" })).toBeInTheDocument();
    expect(numbersShown()).toEqual(["AU-0001", "AU-0002", "AU-0003", "AU-0004"]);
    const row = screen.getByText("AU-0002").closest("tr")!;
    expect(row).toHaveTextContent("Meier, Anna");
    expect(row).toHaveTextContent("Hauptstr. 1");
    expect(row).toHaveTextContent("03/11/2026");
    expect(row).toHaveTextContent("08:30");
    expect(row).toHaveTextContent("Anna Berg");
    expect(row).toHaveTextContent("In Arbeit");
  });

  it("filters by status", async () => {
    render();
    fireEvent.click(await screen.findByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Erledigt" }));
    expect(numbersShown()).toEqual(["AU-0003"]);
  });

  it("filters by technician", async () => {
    render();
    fireEvent.click(await screen.findByRole("combobox", { name: "Monteur" }));
    fireEvent.click(await screen.findByRole("option", { name: "Ben Roth" }));
    expect(numbersShown()).toEqual(["AU-0003", "AU-0004"]);
  });

  it("filters by date range, inclusive, leaving out unscheduled orders", async () => {
    render();
    await screen.findByText("AU-0001");
    fireEvent.click(within(screen.getByRole("group", { name: "Von" })).getByText("test-pick"));
    expect(numbersShown()).toEqual(["AU-0002", "AU-0003", "AU-0004"]);
    fireEvent.click(within(screen.getByRole("group", { name: "Bis" })).getByText("test-pick"));
    expect(numbersShown()).toEqual(["AU-0002", "AU-0004"]);
    fireEvent.click(screen.getByRole("button", { name: "Zeitraum zurücksetzen" }));
    expect(numbersShown()).toHaveLength(4);
  });

  it("shows only unscheduled orders under Nicht eingeplant", async () => {
    render();
    const toggle = await screen.findByRole("button", { name: "Nicht eingeplant" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(numbersShown()).toEqual(["AU-0001"]);
  });

  it("opens an order on row click", async () => {
    render();
    fireEvent.click((await screen.findByText("AU-0003")).closest("tr")!);
    expect(navigate).toHaveBeenCalledWith(orderPath("o3"));
  });

  it("creates a direct order for the picked customer and opens it", async () => {
    create.mockImplementation((_vars, opts) => opts.onSuccess("new1"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Auftrag anlegen" }));
    fireEvent.click(await screen.findByText("test-pick-customer"));
    fireEvent.click(screen.getByRole("button", { name: "Auftrag erstellen" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(orderPath("new1")));
    expect(create.mock.calls[0][0]).toEqual({ customer_id: "k1" });
  });

  it("shows the empty state and the load error", async () => {
    state.rows = [];
    const { unmount } = render();
    expect(await screen.findByText("Noch keine Aufträge")).toBeInTheDocument();
    unmount();
    state.error = true;
    render();
    expect(await screen.findByText("Die Aufträge konnten nicht geladen werden.")).toBeInTheDocument();
  });
});
