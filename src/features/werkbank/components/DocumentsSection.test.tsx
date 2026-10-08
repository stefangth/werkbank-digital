import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, navigate, createQuote, createOrder, createInvoice, useInvoices } = vi.hoisted(() => ({
  state: { quotes: [] as unknown[], orders: [] as unknown[], invoices: [] as unknown[], profileLoading: false },
  createInvoice: vi.fn(),
  useInvoices: vi.fn(),
  navigate: vi.fn(),
  createQuote: vi.fn(),
  createOrder: vi.fn(),
}));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("../hooks/useQuotes", () => ({
  useQuoteList: () => ({ data: state.quotes, isLoading: false, isError: false }),
  useQuoteMutations: () => ({ create: { mutate: createQuote, isPending: false } }),
}));
vi.mock("../hooks/useInvoices", () => ({
  useInvoices: (q: unknown) => { useInvoices(q); return { data: state.invoices, isLoading: false, isError: false }; },
  useInvoiceMutations: () => ({ create: { mutate: createInvoice, isPending: false } }),
}));
vi.mock("../hooks/useOrders", () => ({
  useOrderList: () => ({ data: state.orders, isLoading: false, isError: false }),
  useOrderMutations: () => ({ create: { mutate: createOrder, isPending: false } }),
}));
vi.mock("../hooks/useCompanyProfile", () => ({
  useCompanyProfile: () => ({ data: state.profileLoading ? undefined : { quote_validity_days: 14 }, isLoading: state.profileLoading }),
}));

import { DocumentsSection } from "./DocumentsSection";

const q = (over: Record<string, unknown>) => ({
  id: "q", quote_no: "A-0001", version: 1, status: "draft", is_expired: false, customer_id: "k1", property_id: null,
  subject: "Heizung", gross_total: 119, ...over,
});
const o = (over: Record<string, unknown>) => ({
  id: "o", order_no: "AU-0001", status: "open", customer_id: "k1", property_id: null, subject: "Wartung", gross_total: 238, ...over,
});

const inv = (over: Record<string, unknown>) => ({
  id: "i", invoice_no: "RE-0001", type: "invoice", status: "issued", customer_id: "k1", property_id: null, subject: "Rechnung Heizung", gross_total: 119, ...over,
});

const render = (props: { customerId?: string; propertyId?: string }) =>
  renderWithProviders(
    <MemoryRouter><DocumentsSection {...props} /></MemoryRouter>,
    { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never } },
  );

describe("DocumentsSection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.quotes = [
      q({ id: "q1", quote_no: "A-0001", customer_id: "k1", property_id: "p1" }),
      q({ id: "q2", quote_no: "A-0002", customer_id: "k1", property_id: null, version: 2 }),
      q({ id: "q3", quote_no: "A-0003", customer_id: "k2", property_id: "p9" }),
    ];
    state.orders = [
      o({ id: "o1", order_no: "AU-0001", customer_id: "k1", property_id: "p1" }),
      o({ id: "o2", order_no: "AU-0002", customer_id: "k2", property_id: "p9", status: "done" }),
    ];
    state.invoices = [
      inv({ id: "i1", invoice_no: "RE-0001" }),
      inv({ id: "i2", invoice_no: null, status: "draft", subject: "Entwurf" }),
      inv({ id: "i3", invoice_no: "RE-0002", type: "cancellation", gross_total: 119, subject: "Gutschrift Heizung" }),
    ];
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  it("keeps the create quote button disabled while the company profile loads", async () => {
    state.profileLoading = true;
    try {
      render({ customerId: "k1" });
      expect(await screen.findByRole("button", { name: "Angebot anlegen" })).toBeDisabled();
      expect(createQuote).not.toHaveBeenCalled();
    } finally {
      state.profileLoading = false;
    }
  });

  it("lists only the customer's quotes and orders, with the version in the number", () => {
    render({ customerId: "k1" });
    expect(screen.getByText("A-0001")).toBeInTheDocument();
    expect(screen.getByText("A-0002-2")).toBeInTheDocument();
    expect(screen.queryByText("A-0003")).not.toBeInTheDocument();
    expect(screen.getByText("AU-0001")).toBeInTheDocument();
    expect(screen.queryByText("AU-0002")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A-0001" })).toHaveAttribute("href", "/quotes/q1");
    expect(screen.getByRole("link", { name: "AU-0001" })).toHaveAttribute("href", "/orders/o1");
  });

  it("lists only the property's documents on a property page", () => {
    render({ customerId: "k1", propertyId: "p1" });
    expect(screen.getByText("A-0001")).toBeInTheDocument();
    expect(screen.queryByText("A-0002-2")).not.toBeInTheDocument();
    expect(screen.queryByText("A-0003")).not.toBeInTheDocument();
    expect(screen.getByText("AU-0001")).toBeInTheDocument();
  });

  it("shows an empty hint per table", () => {
    state.quotes = []; state.orders = []; state.invoices = [];
    render({ customerId: "k1" });
    expect(screen.getByText("Noch keine Angebote.")).toBeInTheDocument();
    expect(screen.getByText("Noch keine Aufträge.")).toBeInTheDocument();
    expect(screen.getByText("Noch keine Rechnungen.")).toBeInTheDocument();
  });

  it("creates a quote with customer and property preselected and opens it", () => {
    createQuote.mockImplementation((_v, opts) => opts.onSuccess("qNew"));
    render({ customerId: "k1", propertyId: "p1" });
    fireEvent.click(screen.getByRole("button", { name: "Angebot anlegen" }));
    expect(createQuote).toHaveBeenCalledWith(
      { draft: { customer_id: "k1", property_id: "p1" }, profile: { quote_validity_days: 14 } },
      expect.anything(),
    );
    expect(navigate).toHaveBeenCalledWith("/quotes/qNew");
  });

  it("creates an order with customer and property preselected and opens it", () => {
    createOrder.mockImplementation((_v, opts) => opts.onSuccess("oNew"));
    render({ customerId: "k1", propertyId: "p1" });
    fireEvent.click(screen.getByRole("button", { name: "Auftrag anlegen" }));
    expect(createOrder).toHaveBeenCalledWith({ customer_id: "k1", property_id: "p1" }, expect.anything());
    expect(navigate).toHaveBeenCalledWith("/orders/oNew");
  });

  it("on a customer page creates without a property", () => {
    render({ customerId: "k1" });
    fireEvent.click(screen.getByRole("button", { name: "Auftrag anlegen" }));
    expect(createOrder).toHaveBeenCalledWith({ customer_id: "k1", property_id: null }, expect.anything());
  });

  it("keeps the two tables apart", () => {
    render({ customerId: "k1" });
    const quotes = within(screen.getByRole("region", { name: "Angebote" }));
    expect(quotes.getByText("A-0001")).toBeInTheDocument();
    expect(quotes.queryByText("AU-0001")).not.toBeInTheDocument();
  });

  it("lists the invoices with number, subject, status and signed gross", () => {
    render({ customerId: "k1" });
    const invoices = within(screen.getByRole("region", { name: "Rechnungen" }));
    expect(invoices.getByRole("link", { name: "RE-0001" })).toHaveAttribute("href", "/invoices/i1");
    expect(invoices.getByText("Rechnung Heizung")).toBeInTheDocument();
    expect(invoices.getAllByText("Ausgestellt").length).toBeGreaterThan(0);
    expect(invoices.getByText("Storno")).toBeInTheDocument();
    expect(invoices.getByRole("link", { name: "Entwurf" })).toHaveAttribute("href", "/invoices/i2");
    const cancellation = invoices.getByText("Gutschrift Heizung").closest("tr")!;
    expect(cancellation).toHaveTextContent("-119,00");
    expect(invoices.queryByText("RE-0003")).not.toBeInTheDocument();
  });

  it("asks for the invoices of the customer, or of the property on a property page", () => {
    render({ customerId: "k1" });
    expect(useInvoices).toHaveBeenLastCalledWith({ filter: "all", search: "", customerId: "k1" });
    render({ customerId: "k1", propertyId: "p1" });
    expect(useInvoices).toHaveBeenLastCalledWith({ filter: "all", search: "", propertyId: "p1" });
  });

  it("creates an invoice with customer and property preselected and opens it", () => {
    createInvoice.mockImplementation((_v, opts) => opts.onSuccess("iNew"));
    render({ customerId: "k1", propertyId: "p1" });
    fireEvent.click(screen.getByRole("button", { name: "Rechnung anlegen" }));
    expect(createInvoice).toHaveBeenCalledWith(
      { customerId: "k1", propertyId: "p1", profile: { quote_validity_days: 14 } },
      expect.anything(),
    );
    expect(navigate).toHaveBeenCalledWith("/invoices/iNew");
  });
});
