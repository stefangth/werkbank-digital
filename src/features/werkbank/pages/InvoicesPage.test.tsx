import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, navigate, create, useInvoicesSpy } = vi.hoisted(() => ({
  state: { rows: [] as unknown[], orders: [] as unknown[] | undefined, balances: new Map<string, unknown>(), loading: false, error: false },
  navigate: vi.fn(),
  create: vi.fn(),
  useInvoicesSpy: vi.fn(),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("../hooks/useInvoices", () => ({
  useInvoices: (q: { filter: string; search: string }) => {
    useInvoicesSpy(q);
    return { data: state.rows, isLoading: state.loading, isError: state.error };
  },
  useInvoiceMutations: () => ({ create: { mutate: create, isPending: false } }),
}));
vi.mock("../hooks/useOpenItems", () => ({ useBalanceMap: () => ({ data: state.balances }) }));
vi.mock("../hooks/useOrders", () => ({
  useOrderList: () => ({ data: state.orders }),
}));
vi.mock("../hooks/useCompanyProfile", () => ({
  useCompanyProfile: () => ({ data: { invoice_intro: "Hallo", payment_due_days: 14 }, isLoading: false }),
}));
vi.mock("../components/CustomerPicker", () => ({
  CustomerPicker: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange("k1")}>test-pick-customer</button>,
}));
vi.mock("../components/PropertyPicker", () => ({
  PropertyPicker: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange("p1")}>test-pick-property</button>,
}));

import { InvoicesPage } from "./InvoicesPage";
import { invoicePath } from "../paths";
import { TONES } from "@/components/ui/tones";

const inv = (over: Record<string, unknown>) => ({
  id: "i", invoice_no: "RE-0001", type: "invoice", status: "issued", customer_name: "Muster HV", property_name: null, subject: "Heizung",
  issue_date: "2026-11-02", due_date: "2026-11-16", gross_total: 119, order_id: null, created_at: "2026-01-01T00:00:00Z", ...over,
});
const rows = [
  inv({ id: "i1", invoice_no: null, status: "draft", issue_date: null, due_date: null }),
  inv({ id: "i2", invoice_no: "RE-0002", gross_total: 238 }),
  inv({ id: "i3", invoice_no: "RE-0003", type: "cancellation", gross_total: 238 }),
];

describe("InvoicesPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.loading = false; state.error = false;
    state.rows = rows;
    state.orders = [];
    state.balances = new Map();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = () =>
    renderWithProviders(<InvoicesPage />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never } });
  const rowsShown = () => screen.getAllByRole("row").slice(1);

  it("lists invoices with the number or Entwurf, shows the page mini", async () => {
    render();
    expect(await screen.findByRole("region", { name: "So funktionieren Rechnungen" })).toBeInTheDocument();
    expect(rowsShown()).toHaveLength(3);
    expect(within(rowsShown()[0]).getAllByRole("cell")[0]).toHaveTextContent("Entwurf");
    expect(within(rowsShown()[1]).getAllByRole("cell")[0]).toHaveTextContent("RE-0002");
  });

  it("shows a cancellation as a negative amount with a Storno pill", async () => {
    render();
    const row = (await screen.findByText("RE-0003")).closest("tr")!;
    expect(row).toHaveTextContent("Storno");
    // Red is risk; the type pill is neutral, as on the invoice page.
    const pill = within(row).getByText("Storno").closest("[class]")!;
    expect(pill.className).toContain(TONES.neutral.bg);
    expect(pill.className).not.toContain(TONES.risk.bg);
    expect(row.textContent).toMatch(/-\s?238,00|−\s?238,00/);
    expect(rowsShown()[1].textContent).not.toMatch(/-\s?238,00/);
  });

  it("queries with the picked filter", async () => {
    render();
    fireEvent.click(await screen.findByRole("tab", { name: /Entwürfe/ }));
    await waitFor(() => expect(useInvoicesSpy).toHaveBeenLastCalledWith({ filter: "draft", search: "" }));
  });

  it("renames the issued filter to Ausgestellt and adds Überfällig", async () => {
    render();
    expect(await screen.findByRole("tab", { name: "Ausgestellt" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Offen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Überfällig" }));
    await waitFor(() => expect(useInvoicesSpy).toHaveBeenLastCalledWith({ filter: "overdue", search: "" }));
  });

  it("shows Zahlstatus and Offen from the balance and narrows Überfällig to invoices past due", async () => {
    state.rows = [inv({ id: "i2", invoice_no: "RE-0002" }), inv({ id: "i4", invoice_no: "RE-0004" })];
    state.balances = new Map([
      ["i2", { invoice_id: "i2", open_amount: 50, payment_state: "partial", days_overdue: 0, last_stage: null }],
      ["i4", { invoice_id: "i4", open_amount: 119, payment_state: "open", days_overdue: 9, last_stage: 1 }],
    ]);
    render();
    expect(await screen.findByRole("columnheader", { name: "Zahlstatus" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Offen" })).toBeInTheDocument();
    const row = screen.getByText("RE-0004").closest("tr")!;
    expect(row).toHaveTextContent("Überfällig");
    expect(row.textContent).toMatch(/119,00/);
    expect(screen.getByText("RE-0002").closest("tr")).toHaveTextContent("Teilweise bezahlt");
    fireEvent.click(screen.getByRole("tab", { name: "Überfällig" }));
    await waitFor(() => expect(screen.queryByText("RE-0002")).not.toBeInTheDocument());
    expect(screen.getByText("RE-0004")).toBeInTheDocument();
  });

  it("debounces the search", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render();
    const input = await screen.findByRole("searchbox", { name: "Rechnungen durchsuchen" });
    fireEvent.change(input, { target: { value: "Meier" } });
    expect(useInvoicesSpy).not.toHaveBeenCalledWith(expect.objectContaining({ search: "Meier" }));
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(useInvoicesSpy).toHaveBeenLastCalledWith({ filter: "all", search: "Meier" });
    vi.useRealTimers();
  });

  it("counts all done orders, drafts included, and links to the done orders", async () => {
    state.orders = [
      { id: "o1", status: "done" },
      { id: "o2", status: "done" },
      { id: "o3", status: "done" },
      { id: "o4", status: "open" },
    ];
    state.rows = [...rows, inv({ id: "i9", order_id: "o1", status: "draft" })];
    render();
    const notice = (await screen.findByText("Erledigt, noch nicht abgerechnet")).closest("div")!;
    expect(notice).toHaveTextContent("3");
    expect(within(notice).getByRole("link", { name: "Aufträge anzeigen" })).toHaveAttribute("href", "/orders?status=done");
  });

  it("hides the notice without done orders and while orders load", async () => {
    state.orders = [{ id: "o1", status: "open" }];
    const { unmount } = render();
    await screen.findByText("RE-0002");
    expect(screen.queryByText("Erledigt, noch nicht abgerechnet")).not.toBeInTheDocument();
    unmount();
    state.orders = undefined;
    render();
    await screen.findByText("RE-0002");
    expect(screen.queryByText("Erledigt, noch nicht abgerechnet")).not.toBeInTheDocument();
  });

  it("opens an invoice on row click", async () => {
    render();
    fireEvent.click((await screen.findByText("RE-0002")).closest("tr")!);
    expect(navigate).toHaveBeenCalledWith(invoicePath("i2"));
  });

  it("creates a free invoice for the picked customer and property and opens the draft", async () => {
    create.mockImplementation((_vars, opts) => opts.onSuccess("new1"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Rechnung anlegen" }));
    fireEvent.click(await screen.findByText("test-pick-customer"));
    fireEvent.click(screen.getByText("test-pick-property"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rechnung anlegen" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(invoicePath("new1")));
    expect(create.mock.calls[0][0]).toEqual({ customerId: "k1", propertyId: "p1", profile: { invoice_intro: "Hallo", payment_due_days: 14 } });
  });

  it("shows the not-yet-invoiced notice in the empty state too", async () => {
    state.rows = [];
    state.orders = [{ id: "o1", status: "done" }];
    render();
    expect(await screen.findByText("Noch keine Rechnungen")).toBeInTheDocument();
    const notice = screen.getByText("Erledigt, noch nicht abgerechnet").closest("div")!;
    expect(notice).toHaveTextContent("1");
  });

  it("shows the empty state and the load error", async () => {
    state.rows = [];
    const { unmount } = render();
    expect(await screen.findByText("Noch keine Rechnungen")).toBeInTheDocument();
    unmount();
    state.error = true;
    render();
    expect(await screen.findByText("Die Rechnungen konnten nicht geladen werden.")).toBeInTheDocument();
  });
});
