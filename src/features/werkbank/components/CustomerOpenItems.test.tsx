import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { st } = vi.hoisted(() => ({
  st: { data: [] as unknown[], isLoading: false, isError: false, query: undefined as unknown },
}));
vi.mock("../hooks/useOpenItems", () => ({
  useOpenItems: (q: unknown) => { st.query = q; return st; },
}));

import { CustomerOpenItems } from "./CustomerOpenItems";

const bal = (id: string, no: string, over: Record<string, unknown> = {}) => ({
  invoice_id: id, invoice_no: no, due_date: "2026-09-01", days_overdue: 0, open_amount: 100, payment_state: "open", last_stage: null, ...over,
});

const renderSection = () => renderWithProviders(<MemoryRouter><CustomerOpenItems customerId="k1" /></MemoryRouter>);

describe("CustomerOpenItems", () => {
  beforeEach(async () => {
    Object.assign(st, { data: [], isLoading: false, isError: false, query: undefined });
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  it("asks for this customer's open items only", () => {
    renderSection();
    expect(st.query).toEqual({ search: "", customerId: "k1" });
  });

  it("renders nothing when the customer has no open items", () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the open total, the credit and the rows linking to the invoices", () => {
    st.data = [
      bal("i1", "RE-0001", { open_amount: 1000, days_overdue: 12, payment_state: "open" }),
      bal("i2", "RE-0002", { open_amount: 250.5, payment_state: "partial" }),
      bal("i3", "RE-0003", { open_amount: -300, payment_state: "overpaid" }),
    ];
    renderSection();
    const region = within(screen.getByRole("region", { name: "Offene Posten" }));
    expect(region.getByTestId("customer-open-total")).toHaveTextContent("1.250,50");
    expect(region.getByTestId("customer-credit")).toHaveTextContent("300,00");
    expect(region.getByRole("link", { name: "RE-0001" })).toHaveAttribute("href", "/invoices/i1");
    expect(region.getByRole("link", { name: "RE-0003" })).toHaveAttribute("href", "/invoices/i3");
    expect(region.getByText("Überfällig")).toBeInTheDocument();
    expect(region.getByText("Guthaben", { selector: "span" })).toBeInTheDocument();
  });

  it("shows no credit line when there is no credit", () => {
    st.data = [bal("i1", "RE-0001")];
    renderSection();
    expect(screen.queryByTestId("customer-credit")).not.toBeInTheDocument();
  });

  it("says so when the items cannot be loaded", () => {
    st.isError = true;
    renderSection();
    expect(screen.getByText("Die offenen Posten konnten nicht geladen werden.")).toBeInTheDocument();
  });
});
