import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, navigate, mut, preview, issue, send, pdf, toast } = vi.hoisted(() => {
  const m = () => ({ mutate: vi.fn(), isPending: false, isSuccess: false });
  return {
    state: { invoice: null as unknown, original: null as unknown, refetch: vi.fn() },
    navigate: vi.fn(),
    mut: { update: m(), remove: m() },
    preview: { mutateAsync: vi.fn(), isPending: false },
    issue: { mutateAsync: vi.fn(), isPending: false },
    send: { mutateAsync: vi.fn(), isPending: false },
    pdf: { tab: { close: vi.fn() }, openPendingTab: vi.fn(), showInTab: vi.fn(), pdfBlobUrl: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
});
vi.mock("sonner", () => ({ toast }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
  useParams: () => ({ id: "i1" }),
}));
vi.mock("../hooks/useInvoices", () => ({
  useInvoice: (id: string | undefined) =>
    id === "i1"
      ? { data: state.invoice, isLoading: false, isError: false, refetch: state.refetch }
      : { data: id ? state.original : undefined, isLoading: false, isError: false, refetch: vi.fn() },
  useInvoiceMutations: () => mut,
}));
vi.mock("../hooks/useInvoiceActions", () => ({
  usePreviewInvoice: () => preview,
  useIssueInvoice: () => issue,
  useSendInvoice: () => send,
}));
vi.mock("../lib/pdfTab", () => ({
  openPendingTab: () => { pdf.openPendingTab(); return pdf.tab; },
  showInTab: (...args: unknown[]) => pdf.showInTab(...args),
  pdfBlobUrl: (b64: string) => pdf.pdfBlobUrl(b64),
}));
vi.mock("../hooks/useCustomers", () => ({
  useCustomer: () => ({ data: {
    id: "c1", kind: "property_manager", company_name: "Muster HV", first_name: null, last_name: null,
    email: "kunde@example.de", invoice_email: "rechnung@example.de", street: "Hauptstr. 1", postal_code: "01067", city: "Dresden",
  } }),
}));
vi.mock("../hooks/useProperties", () => ({ useProperty: () => ({ data: undefined }) }));
vi.mock("../hooks/useContacts", () => ({ useContacts: () => ({ data: [] }) }));
vi.mock("../hooks/useCompanyProfile", () => ({
  useCompanyProfile: () => ({ data: {
    company_name: "Muster GmbH", street: "Weg 1", postal_code: "01067", city: "Dresden",
    email: "info@muster.de", tax_number: "123", vat_id: null, iban: "DE02120300000000202051",
  }, isLoading: false, isError: false }),
}));
vi.mock("../hooks/useDocumentItems", () => ({ useDocumentItems: () => ({ data: [{ id: "l1", kind: "item" }], isLoading: false }) }));
vi.mock("../components/LineItemsEditor", () => ({
  LineItemsEditor: ({ readOnly, docRef }: { readOnly: boolean; docRef: { invoiceId: string } }) =>
    <div data-testid="items" data-readonly={String(readOnly)} data-invoice={docRef.invoiceId} />,
}));
vi.mock("../components/DocumentTotalsCard", () => ({ DocumentTotalsCard: () => <div data-testid="totals" /> }));
vi.mock("../components/CustomerPicker", () => ({ CustomerPicker: () => <div>test-customer-picker</div> }));
vi.mock("../components/PropertyPicker", () => ({ PropertyPicker: () => <div>test-property-picker</div> }));
vi.mock("../components/ContactSelect", () => ({ ContactSelect: () => <div>test-contact-select</div> }));

import { InvoiceActionError } from "../data/invoiceActions";
import { InvoicePage } from "./InvoicePage";
import { INVOICES_PATH, invoicePath } from "../paths";

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "i1", org_id: "org-1", type: "invoice", invoice_no: null, status: "draft", order_id: null, cancels_invoice_id: null,
  customer_id: "c1", property_id: null, contact_id: null, location_note: null, subject: "Heizung", discount_percent: 0,
  intro_text: "Hallo", closing_text: null, payment_terms_text: null, service_date_from: "2026-10-01", service_date_to: null,
  payment_due_days: 14, issue_date: null, due_date: null, issued_at: null, pdf_path: null, sent_at: null, sent_to: null,
  totals: null, ...over,
});

describe("InvoicePage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.invoice = invoice();
    state.original = null;
    pdf.pdfBlobUrl.mockReturnValue("blob:pdf");
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  const render = () =>
    renderWithProviders(<MemoryRouter><InvoicePage /></MemoryRouter>, {
      authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never },
    });

  it("shows the editable draft: header, service dates, payment term, editor and totals", async () => {
    render();
    expect(await screen.findByRole("textbox", { name: "Betreff" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Leistungsdatum von" })).toHaveTextContent("01/10/2026");
    expect(screen.getByRole("button", { name: "Leistungsdatum bis" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Zahlungsziel in Tagen" })).toHaveValue("14");
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "false");
    expect(screen.getByTestId("items")).toHaveAttribute("data-invoice", "i1");
    expect(screen.getByTestId("totals")).toBeInTheDocument();
    for (const name of ["Vorschau", "Löschen", "Abschließen"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("saves the payment term on blur and rejects an invalid one", async () => {
    render();
    const term = await screen.findByRole("textbox", { name: "Zahlungsziel in Tagen" });
    fireEvent.change(term, { target: { value: "30" } });
    fireEvent.blur(term);
    expect(mut.update.mutate.mock.calls[0][0]).toEqual({ id: "i1", patch: { payment_due_days: 30 } });
    fireEvent.change(term, { target: { value: "400" } });
    fireEvent.blur(term);
    expect(mut.update.mutate).toHaveBeenCalledTimes(1);
    expect(term).toHaveValue("14");
  });

  it("clears the optional end of the service period", async () => {
    state.invoice = invoice({ service_date_to: "2026-10-05" });
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Leistungsdatum bis entfernen" }));
    expect(mut.update.mutate.mock.calls[0][0]).toEqual({ id: "i1", patch: { service_date_to: null } });
  });

  it("opens the preview PDF in a tab via pdfTab", async () => {
    preview.mutateAsync.mockResolvedValue("QkFTRTY0");
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Vorschau" }));
    await waitFor(() => expect(pdf.showInTab).toHaveBeenCalled());
    expect(pdf.openPendingTab).toHaveBeenCalled();
    expect(preview.mutateAsync).toHaveBeenCalledWith("i1");
    expect(pdf.pdfBlobUrl).toHaveBeenCalledWith("QkFTRTY0");
    expect(pdf.showInTab.mock.calls[0][0]).toBe(pdf.tab);
    expect(pdf.showInTab.mock.calls[0][1]).toBe("blob:pdf");
  });

  it("closes the tab and toasts when the preview fails", async () => {
    preview.mutateAsync.mockRejectedValue(new InvoiceActionError("render_failed"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Vorschau" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(pdf.tab.close).toHaveBeenCalled();
  });

  it("deletes the draft and returns to the list", async () => {
    mut.remove.mutate.mockImplementation((_id, opts) => opts.onSuccess());
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Löschen/ }));
    expect(mut.remove.mutate.mock.calls[0][0]).toBe("i1");
    expect(navigate).toHaveBeenCalledWith(INVOICES_PATH);
  });

  it("turns read only when a save hits an invoice issued meanwhile", async () => {
    mut.update.mutate.mockImplementation((_v, opts) => opts.onError(new Error("invoice_locked")));
    render();
    const subject = await screen.findByRole("textbox", { name: "Betreff" });
    fireEvent.change(subject, { target: { value: "Bad" } });
    fireEvent.blur(subject);
    expect(state.refetch).toHaveBeenCalled();
  });

  it("refetches into the issued state after a 502 send_failed", async () => {
    issue.mutateAsync.mockRejectedValue(new InvoiceActionError("send_failed", [], true));
    state.refetch.mockImplementation(() => {
      state.invoice = invoice({ status: "issued", invoice_no: "RE-0012", issue_date: "2026-10-08", due_date: "2026-10-22" });
    });
    const view = render();
    fireEvent.click(await screen.findByRole("button", { name: "Abschließen" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Danach ist die Rechnung nicht mehr änderbar.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Abschließen und senden" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Abgeschlossen, Versand fehlgeschlagen"));
    expect(state.refetch).toHaveBeenCalled();
    view.rerender(<MemoryRouter><InvoicePage /></MemoryRouter>);
    expect(await screen.findByText("RE-0012")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Betreff" })).not.toBeInTheDocument();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "true");
  });

  it("refetches after a 409 so the page can turn read only", async () => {
    issue.mutateAsync.mockRejectedValue(new InvoiceActionError("invalid_state"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Abschließen" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Nur abschließen" }));
    await waitFor(() => expect(state.refetch).toHaveBeenCalled());
  });

  it("renders a read-only fallback for a non-draft without crashing", async () => {
    state.invoice = invoice({ status: "issued", invoice_no: "RE-0012", issue_date: "2026-10-08", due_date: "2026-10-22" });
    render();
    expect(await screen.findByText("RE-0012")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abschließen" })).not.toBeInTheDocument();
  });

  it("locks customer, discount and items on a cancellation draft and links the original", async () => {
    state.invoice = invoice({ type: "cancellation", cancels_invoice_id: "orig" });
    state.original = invoice({ id: "orig", status: "issued", invoice_no: "RE-0011" });
    render();
    expect(await screen.findByRole("heading", { name: "Stornorechnung" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /RE-0011/ })).toHaveAttribute("href", invoicePath("orig"));
    expect(screen.queryByText("test-customer-picker")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Rabatt in Prozent" })).not.toBeInTheDocument();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "true");
    expect(screen.getByRole("textbox", { name: "Einleitung" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Zahlungsziel in Tagen" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Leistungsdatum von" })).toBeInTheDocument();
  });
});
