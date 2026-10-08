import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { st, issue, toast } = vi.hoisted(() => ({
  st: { open: [] as unknown[], due: [] as unknown[], credit: 0, loading: false, error: false },
  issue: { mutateAsync: vi.fn(), isPending: false },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("../hooks/useOpenItems", () => ({
  useOpenItems: () => ({ data: st.open, isLoading: st.loading, isError: st.error }),
  useDunningDue: () => ({ data: st.due, isLoading: false, isError: false }),
  useCustomerCredit: () => ({ data: st.credit }),
}));
vi.mock("../hooks/useDunningActions", () => ({ useIssueDunning: () => issue }));

import { OpenItemsPage } from "./OpenItemsPage";

const bal = (id: string, no: string, over: Record<string, unknown> = {}) => ({
  invoice_id: id, invoice_no: no, customer_name: "Muster HV", property_name: null, due_date: "2026-09-01", days_overdue: 0,
  open_amount: 100, payment_state: "open", last_stage: null, hold_reason: null, hold_until: null, ...over,
});
const due = (id: string, no: string, over: Record<string, unknown> = {}) => ({
  ...bal(id, no, { days_overdue: 20 }), next_stage: 1, customer_invoice_email: "rechnung@example.de", customer_email: null, contact_email: null, ...over,
});

describe("OpenItemsPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(st, { open: [], due: [], credit: 0, loading: false, error: false });
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = () =>
    renderWithProviders(<OpenItemsPage />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never } });
  const body = () => screen.getAllByRole("row").slice(1);

  it("shows the empty state when nothing is open", async () => {
    render();
    expect(await screen.findByText("Nichts offen")).toBeInTheDocument();
  });

  it("sorts by days overdue, shows credit as negative and the hold reason as tooltip trigger", async () => {
    st.open = [
      bal("a", "RE-1", { days_overdue: 3, open_amount: 50 }),
      bal("b", "RE-2", { days_overdue: 30, open_amount: 200, hold_reason: "Reklamation" }),
      bal("c", "RE-3", { days_overdue: 0, open_amount: -40, payment_state: "overpaid" }),
    ];
    st.credit = 40;
    render();
    await screen.findByText("RE-1");
    expect(body().map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["RE-2", "RE-1", "RE-3"]);
    expect(body()[2].textContent).toMatch(/-\s?40,00|−\s?40,00/);
    expect(within(body()[0]).getByLabelText("Mahnsperre: Reklamation")).toBeInTheDocument();
    expect(within(body()[1]).queryByLabelText(/Mahnsperre/)).not.toBeInTheDocument();
  });

  it("totals open and overdue in the tiles", async () => {
    st.open = [bal("a", "RE-1", { days_overdue: 3, open_amount: 50 }), bal("b", "RE-2", { open_amount: 200 }), bal("c", "RE-3", { open_amount: -40 })];
    st.credit = 40;
    render();
    await screen.findByText("RE-1");
    const tiles = screen.getByTestId("open-items-kpis");
    expect(tiles).toHaveTextContent(/250,00/);
    expect(tiles).toHaveTextContent(/50,00/);
    expect(tiles).toHaveTextContent(/40,00/);
  });

  it("selects due invoices and opens the confirm dialog", async () => {
    st.due = [due("a", "RE-1"), due("b", "RE-2", { customer_invoice_email: null })];
    render();
    fireEvent.click(await screen.findByRole("tab", { name: /Mahnfällig/ }));
    const bulk = screen.getByRole("button", { name: "Ausgewählte mahnen" });
    expect(bulk).toBeDisabled();
    expect(within(body()[0]).getByText("Zahlungserinnerung")).toBeInTheDocument();
    // the row without an address cannot be selected and offers the print action
    expect(within(body()[1]).getByRole("checkbox")).toBeDisabled();
    expect(within(body()[1]).getByRole("button", { name: "PDF für Postversand" })).toBeInTheDocument();
    fireEvent.click(within(body()[0]).getByRole("checkbox"));
    fireEvent.click(bulk);
    expect(await screen.findByRole("dialog")).toHaveTextContent("1 Mahnung wird versendet");
  });

  it("creates a print-only notice for a row without address", async () => {
    st.due = [due("b", "RE-2", { customer_invoice_email: null })];
    issue.mutateAsync.mockResolvedValue({ noticeId: "n", stage: 1 });
    render();
    fireEvent.click(await screen.findByRole("tab", { name: /Mahnfällig/ }));
    fireEvent.click(screen.getByRole("button", { name: "PDF für Postversand" }));
    await vi.waitFor(() => expect(issue.mutateAsync).toHaveBeenCalledWith({ invoiceId: "b", delivery: "print" }));
    expect(toast.success).toHaveBeenCalled();
  });
});
