import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, navigate, create } = vi.hoisted(() => ({
  state: { rows: [] as unknown[], loading: false, error: false, search: "" },
  navigate: vi.fn(),
  create: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate, useSearchParams: () => [new URLSearchParams(state.search)] }));
vi.mock("../hooks/useQuotes", () => ({
  useQuoteList: () => ({ data: state.rows, isLoading: state.loading, isError: state.error }),
  useQuoteMutations: () => ({ create: { mutate: create, isPending: false } }),
}));
vi.mock("../hooks/useCompanyProfile", () => ({
  useCompanyProfile: () => ({ data: { quote_validity_days: 14 }, isLoading: false }),
}));
vi.mock("../components/CustomerPicker", () => ({
  CustomerPicker: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange("k1")}>test-pick-customer</button>,
}));

import { QuotesPage } from "./QuotesPage";
import { quotePath } from "../paths";

const q = (over: Record<string, unknown>) => ({
  id: "q", quote_no: "A-0001", version: 1, status: "draft", is_expired: false, has_order: false, customer_id: "k1",
  customer_name: "Muster HV", property_name: null, subject: "Heizung", valid_until: "2026-12-01", net_total: 100, gross_total: 119,
  created_at: "2026-01-01T00:00:00Z", ...over,
});

describe("QuotesPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.loading = false; state.error = false; state.search = "";
    state.rows = [
      q({ id: "q1", quote_no: "A-0001", status: "draft", subject: "Heizung warten" }),
      q({ id: "q2", quote_no: "A-0002", status: "sent", customer_name: "Meier, Anna", subject: "Bad" }),
      q({ id: "q3", quote_no: "A-0003", status: "sent", is_expired: true, subject: "Dach" }),
      q({ id: "q4", quote_no: "A-0004", status: "accepted", has_order: false, subject: "Fenster" }),
      q({ id: "q5", quote_no: "A-0005", status: "accepted", has_order: true, subject: "Tür" }),
      q({ id: "q6", quote_no: "A-0006", version: 2, status: "rejected", subject: "Keller" }),
    ];
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = () =>
    renderWithProviders(<QuotesPage />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never } });
  const rowsShown = () => screen.getAllByRole("row").slice(1);

  it("lists quotes with the number including the version, and shows the page mini", async () => {
    render();
    expect(await screen.findByRole("region", { name: "So funktionieren Angebote" })).toBeInTheDocument();
    expect(screen.getByText("A-0006-2")).toBeInTheDocument();
    expect(rowsShown()).toHaveLength(6);
  });

  it("filters by display status, expired included", async () => {
    render();
    fireEvent.click(await screen.findByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Abgelaufen" }));
    expect(rowsShown()).toHaveLength(1);
    expect(screen.getByText("A-0003")).toBeInTheDocument();
  });

  it("does not list an expired quote under Versendet", async () => {
    render();
    fireEvent.click(await screen.findByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Versendet" }));
    expect(rowsShown().map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["A-0002"]);
  });

  it("searches number, customer and subject", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render();
    const input = await screen.findByRole("searchbox", { name: "Angebote durchsuchen" });
    for (const [needle, no] of [["a-0004", "A-0004"], ["meier", "A-0002"], ["keller", "A-0006-2"]] as const) {
      fireEvent.change(input, { target: { value: needle } });
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(rowsShown()).toHaveLength(1);
      expect(screen.getByText(no)).toBeInTheDocument();
    }
    vi.useRealTimers();
  });

  it("counts accepted quotes without an order in a notice", async () => {
    render();
    const notice = await screen.findByText("Angenommen, noch kein Auftrag");
    expect(notice.parentElement).toHaveTextContent("1");
  });

  it("Anzeigen in the notice lists only accepted quotes without an order, with a visible filter to clear", async () => {
    render();
    const notice = (await screen.findByText("Angenommen, noch kein Auftrag")).closest("div")!;
    const toggle = screen.getByRole("button", { name: "Ohne Auftrag" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(notice).getByRole("button", { name: "Anzeigen" }));
    expect(rowsShown().map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["A-0004"]);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(rowsShown().map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["A-0004", "A-0005"]);
  });

  it("shows the no-order filter as active when opened from the dashboard link", async () => {
    state.search = "?status=accepted&noOrder=1";
    render();
    expect(await screen.findByRole("button", { name: "Ohne Auftrag" })).toHaveAttribute("aria-pressed", "true");
  });

  it("applies the dashboard filters again when the search params change while mounted", async () => {
    state.rows = [q({ id: "q1", quote_no: "A-0001", status: "draft" }), q({ id: "q2", quote_no: "A-0002", status: "accepted", has_order: false })];
    const { rerender } = render();
    await screen.findByText("A-0001");
    expect(screen.getByRole("button", { name: "Ohne Auftrag" })).toHaveAttribute("aria-pressed", "false");
    state.search = "?status=accepted&noOrder=1";
    rerender(<QuotesPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Ohne Auftrag" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText("A-0001")).not.toBeInTheDocument();
    state.search = "";
    rerender(<QuotesPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Ohne Auftrag" })).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByText("A-0001")).toBeInTheDocument();
  });

  it("shows no notice when every accepted quote has an order", async () => {
    state.rows = [q({ id: "q5", status: "accepted", has_order: true })];
    render();
    await screen.findByText("A-0001");
    expect(screen.queryByText("Angenommen, noch kein Auftrag")).not.toBeInTheDocument();
  });

  it("opens a quote on row click", async () => {
    render();
    fireEvent.click((await screen.findByText("A-0002")).closest("tr")!);
    expect(navigate).toHaveBeenCalledWith(quotePath("q2"));
  });

  it("creates a draft for the picked customer and opens it", async () => {
    create.mockImplementation((_vars, opts) => opts.onSuccess("new1"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Angebot anlegen" }));
    fireEvent.click(await screen.findByText("test-pick-customer"));
    fireEvent.click(screen.getByRole("button", { name: "Entwurf anlegen" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(quotePath("new1")));
    expect(create.mock.calls[0][0]).toEqual({ draft: { customer_id: "k1" }, profile: { quote_validity_days: 14 } });
  });

  it("shows the empty state and the load error", async () => {
    state.rows = [];
    const { unmount } = render();
    expect(await screen.findByText("Noch keine Angebote")).toBeInTheDocument();
    unmount();
    state.error = true;
    render();
    expect(await screen.findByText("Die Angebote konnten nicht geladen werden.")).toBeInTheDocument();
  });

  it("opens pre-filtered from the dashboard link: accepted quotes without an order", async () => {
    state.search = "?status=accepted&noOrder=1";
    render();
    await screen.findByText("A-0004");
    expect(rowsShown()).toHaveLength(1);
    expect(screen.getByText("A-0004")).toBeInTheDocument();
  });

  it("applies a status from the URL without the no-order restriction", async () => {
    state.search = "?status=accepted";
    render();
    await screen.findByText("A-0004");
    expect(rowsShown()).toHaveLength(2);
  });

  it("ignores an unknown status in the URL", async () => {
    state.search = "?status=bogus";
    render();
    await screen.findByText("A-0004");
    expect(rowsShown()).toHaveLength(6);
  });
});
