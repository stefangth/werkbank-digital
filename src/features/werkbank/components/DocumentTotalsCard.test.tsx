import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";
import { DocumentTotalsCard } from "./DocumentTotalsCard";
import type { DocumentTotals } from "../data/quotes";

const totals = (over: Partial<DocumentTotals> = {}): DocumentTotals => ({
  quote_id: "q1", order_id: null, invoice_id: null, net_total: 1000, discount_total: 0, vat_total: 175, gross_total: 1175, labour_total: 400,
  vat_breakdown: [
    { rate: 19, net: 500, discounted_net: 500, vat: 95 },
    { rate: 7, net: 500, discounted_net: 500, vat: 35 },
  ],
  ...over,
});

describe("DocumentTotalsCard", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows net, one VAT row per rate and gross", () => {
    renderWithProviders(<DocumentTotalsCard totals={totals()} isPrivateCustomer={false} />);
    expect(screen.getByText("Netto")).toBeInTheDocument();
    expect(screen.getByText("MwSt. 19 %")).toBeInTheDocument();
    expect(screen.getByText("MwSt. 7 %")).toBeInTheDocument();
    expect(screen.getByText("Brutto")).toBeInTheDocument();
    expect(screen.getByText(/1\.175,00/)).toBeInTheDocument();
  });

  it("hides the discount at zero and shows it otherwise", () => {
    const { rerender } = renderWithProviders(<DocumentTotalsCard totals={totals()} isPrivateCustomer={false} />);
    expect(screen.queryByText("Rabatt")).not.toBeInTheDocument();
    rerender(<DocumentTotalsCard totals={totals({ discount_total: 50 })} isPrivateCustomer={false} />);
    expect(screen.getByText("Rabatt")).toBeInTheDocument();
  });

  it("shows the labour share only for private customers", () => {
    const { rerender } = renderWithProviders(<DocumentTotalsCard totals={totals()} isPrivateCustomer={false} />);
    expect(screen.queryByText(/Lohnanteil/)).not.toBeInTheDocument();
    rerender(<DocumentTotalsCard totals={totals()} isPrivateCustomer />);
    expect(screen.getByText("davon Lohnanteil (§35a EStG)")).toBeInTheDocument();
  });

  it("renders zeros without totals", () => {
    renderWithProviders(<DocumentTotalsCard totals={null} isPrivateCustomer={false} />);
    expect(screen.getByText("Brutto")).toBeInTheDocument();
  });

  it("shows the amounts negative for a cancellation document, without doubling the sign", () => {
    renderWithProviders(<DocumentTotalsCard totals={totals({ discount_total: 50 })} isPrivateCustomer={false} negate />);
    expect(screen.getByText(/^-1\.175,00/)).toBeInTheDocument();
    expect(screen.getByText(/^-1\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/^50,00/)).toBeInTheDocument();
    expect(screen.queryByText(/--/)).not.toBeInTheDocument();
  });
});
