import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { profile, items, contacts, customer, property, issue, send, toast } = vi.hoisted(() => ({
  profile: { data: null as unknown, isLoading: false, isError: false },
  items: { data: [] as unknown[], isLoading: false },
  contacts: { data: [] as unknown[] },
  customer: { data: null as unknown, isError: false },
  property: { data: null as unknown, isError: false },
  issue: { mutateAsync: vi.fn(), isPending: false },
  send: { mutateAsync: vi.fn(), isPending: false },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("../hooks/useCompanyProfile", () => ({ useCompanyProfile: () => profile }));
vi.mock("../hooks/useDocumentItems", () => ({ useDocumentItems: () => items }));
vi.mock("../hooks/useContacts", () => ({ useContacts: () => contacts }));
vi.mock("../hooks/useCustomers", () => ({ useCustomer: () => customer }));
vi.mock("../hooks/useProperties", () => ({ useProperty: () => property }));
vi.mock("../hooks/useInvoiceActions", () => ({ useIssueInvoice: () => issue, useSendInvoice: () => send }));

import { InvoiceActionError } from "../data/invoiceActions";
import { IssueInvoiceDialog } from "./IssueInvoiceDialog";

const COMPLETE = {
  company_name: "Muster GmbH", street: "Weg 1", postal_code: "01067", city: "Dresden",
  email: "info@muster.de", tax_number: "123", vat_id: null, iban: "DE02120300000000202051",
};
const CUSTOMER = {
  id: "c1", kind: "property_manager", email: "kunde@example.de", invoice_email: "rechnung@example.de",
  street: "Hauptstr. 1", postal_code: "01067", city: "Dresden",
};
const invoice = (over: Record<string, unknown> = {}) => ({
  id: "i1", customer_id: "c1", property_id: null, contact_id: "k1", type: "invoice",
  service_date_from: "2026-10-01", invoice_no: null, ...over,
});

const renderDialog = (opts: { inv?: ReturnType<typeof invoice>; mode?: "issue" | "send"; resend?: boolean; onOpenChange?: () => void; onStateChanged?: () => void } = {}) =>
  renderWithProviders(
    <IssueInvoiceDialog
      invoice={(opts.inv ?? invoice()) as never}
      mode={opts.mode ?? "issue"}
      resend={opts.resend}
      open
      onOpenChange={opts.onOpenChange ?? vi.fn()}
      onStateChanged={opts.onStateChanged ?? vi.fn()}
    />,
    { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } },
  );

describe("IssueInvoiceDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    profile.data = COMPLETE;
    profile.isError = false;
    items.data = [{ id: "l1", kind: "item" }];
    contacts.data = [{ id: "k1", email: "kontakt@example.de" }];
    customer.data = CUSTOMER;
    property.data = null;
    customer.isError = false;
    property.isError = false;
    issue.mutateAsync.mockResolvedValue({ invoiceNo: "RE-0012", emailSent: true });
    send.mutateAsync.mockResolvedValue({ emailSent: true });
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows the irreversibility warning", () => {
    renderDialog();
    expect(screen.getByText("Danach ist die Rechnung nicht mehr änderbar.")).toBeInTheDocument();
  });

  it("prefills the customer's invoice email first", () => {
    renderDialog();
    expect(screen.getByLabelText("An")).toHaveValue("rechnung@example.de");
  });

  it("falls back to the contact email, then the customer email", () => {
    customer.data = { ...CUSTOMER, invoice_email: null };
    const { unmount } = renderDialog();
    expect(screen.getByLabelText("An")).toHaveValue("kontakt@example.de");
    unmount();
    contacts.data = [{ id: "k1", email: null }];
    renderDialog();
    expect(screen.getByLabelText("An")).toHaveValue("kunde@example.de");
  });

  it("lists the preflight blockers and disables both buttons", () => {
    profile.data = { ...COMPLETE, iban: null };
    items.data = [{ id: "t1", kind: "title" }];
    customer.data = { ...CUSTOMER, street: "" };
    renderDialog({ inv: invoice({ service_date_from: null }) });
    expect(screen.getByText(/keine Position/)).toBeInTheDocument();
    expect(screen.getByText(/Leistungsdatum/)).toBeInTheDocument();
    expect(screen.getByText(/Firmendaten/)).toBeInTheDocument();
    expect(screen.getByText(/Rechnungsanschrift/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nur abschließen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abschließen und senden" })).toBeDisabled();
  });

  it("uses the property's billing address when it has one", () => {
    customer.data = { ...CUSTOMER, street: "" };
    property.data = { id: "p1", billing_name: "WEG", billing_street: "Ring 2", billing_postal_code: "01069", billing_city: "Dresden" };
    renderDialog({ inv: invoice({ property_id: "p1" }) });
    expect(screen.queryByText(/Rechnungsanschrift/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nur abschließen" })).toBeEnabled();
  });

  it("blocks only the send button without a recipient", () => {
    customer.data = { ...CUSTOMER, invoice_email: null, email: null };
    contacts.data = [];
    renderDialog();
    expect(screen.getByText(/Empfänger/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nur abschließen" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Abschließen und senden" })).toBeDisabled();
  });

  it("Nur abschließen issues without send", async () => {
    const onOpenChange = vi.fn();
    const onStateChanged = vi.fn();
    renderDialog({ onOpenChange, onStateChanged });
    fireEvent.click(screen.getByRole("button", { name: "Nur abschließen" }));
    await waitFor(() => expect(issue.mutateAsync).toHaveBeenCalledWith({ invoiceId: "i1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onStateChanged).toHaveBeenCalled();
  });

  it("Abschließen und senden passes to, cc and message", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Kopie (CC)"), { target: { value: "chef@example.de" } });
    fireEvent.change(screen.getByLabelText("Nachricht"), { target: { value: "Hallo" } });
    fireEvent.click(screen.getByRole("button", { name: "Abschließen und senden" }));
    await waitFor(() => expect(issue.mutateAsync).toHaveBeenCalledWith({
      invoiceId: "i1", send: { to: ["rechnung@example.de"], cc: ["chef@example.de"], message: "Hallo" },
    }));
  });

  it("prefills a message", () => {
    renderDialog();
    expect((screen.getByLabelText("Nachricht") as HTMLTextAreaElement).value).toMatch(/Rechnung/);
  });

  it("a 502 send_failed after issue toasts and refetches", async () => {
    issue.mutateAsync.mockRejectedValue(new InvoiceActionError("send_failed", [], true));
    const onOpenChange = vi.fn();
    const onStateChanged = vi.fn();
    renderDialog({ onOpenChange, onStateChanged });
    fireEvent.click(screen.getByRole("button", { name: "Abschließen und senden" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Abgeschlossen, Versand fehlgeschlagen"));
    expect(onStateChanged).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("an issue whose email did not go out reports the same", async () => {
    issue.mutateAsync.mockResolvedValue({ invoiceNo: "RE-0012", emailSent: false });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Abschließen und senden" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Abgeschlossen, Versand fehlgeschlagen"));
  });

  it("a 409 invalid_state refetches and closes", async () => {
    issue.mutateAsync.mockRejectedValue(new InvoiceActionError("invalid_state"));
    const onOpenChange = vi.fn();
    const onStateChanged = vi.fn();
    renderDialog({ onOpenChange, onStateChanged });
    fireEvent.click(screen.getByRole("button", { name: "Nur abschließen" }));
    await waitFor(() => expect(onStateChanged).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("an order that is not done shows the orderNotDone copy inline and keeps the dialog open", async () => {
    issue.mutateAsync.mockRejectedValue(new InvoiceActionError("invalid_state", [], false, "order_not_done"));
    const onOpenChange = vi.fn();
    const onStateChanged = vi.fn();
    renderDialog({ onOpenChange, onStateChanged });
    fireEvent.click(screen.getByRole("button", { name: "Nur abschließen" }));
    expect(await screen.findByText("Der Auftrag muss erledigt sein, bevor er abgerechnet werden kann.")).toBeInTheDocument();
    expect(onStateChanged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("a 500 render_failed after issue refetches", async () => {
    issue.mutateAsync.mockRejectedValue(new InvoiceActionError("render_failed", [], true));
    const onStateChanged = vi.fn();
    renderDialog({ onStateChanged });
    fireEvent.click(screen.getByRole("button", { name: "Nur abschließen" }));
    await waitFor(() => expect(onStateChanged).toHaveBeenCalled());
  });

  it("shows the server's blockers from a 422 inline", async () => {
    issue.mutateAsync.mockRejectedValue(new InvoiceActionError("preflight_failed", ["no_items"]));
    const onStateChanged = vi.fn();
    renderDialog({ onStateChanged });
    fireEvent.click(screen.getByRole("button", { name: "Nur abschließen" }));
    expect(await screen.findByText(/keine Position/)).toBeInTheDocument();
    expect(onStateChanged).not.toHaveBeenCalled();
  });

  describe("send mode", () => {
    const issued = () => invoice({ invoice_no: "RE-0012", service_date_from: null });

    it("hides the warning and Nur abschließen, and ignores the issue blockers", () => {
      items.data = [];
      renderDialog({ inv: issued(), mode: "send" });
      expect(screen.queryByText("Danach ist die Rechnung nicht mehr änderbar.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Nur abschließen" })).not.toBeInTheDocument();
      expect(screen.queryByText(/keine Position/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Senden" })).toBeEnabled();
    });

    it("calls sendInvoice with the recipients", async () => {
      const onOpenChange = vi.fn();
      renderDialog({ inv: issued(), mode: "send", onOpenChange });
      fireEvent.click(screen.getByRole("button", { name: "Senden" }));
      await waitFor(() => expect(send.mutateAsync).toHaveBeenCalledWith({
        invoiceId: "i1", body: expect.objectContaining({ to: ["rechnung@example.de"], cc: [] }),
      }));
      expect(issue.mutateAsync).not.toHaveBeenCalled();
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("blocks Senden without a recipient", () => {
      customer.data = { ...CUSTOMER, invoice_email: null, email: null };
      contacts.data = [];
      renderDialog({ inv: issued(), mode: "send" });
      expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled();
    });
  });

  it("uses the again wording when an invoice that went out is sent once more", () => {
    renderDialog({ mode: "send", resend: true });
    expect(screen.getByRole("heading", { name: "Rechnung erneut senden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut senden" })).toBeEnabled();
  });

  it("explains a failed customer load instead of staying disabled silently", () => {
    customer.data = null;
    customer.isError = true;
    renderDialog();
    expect(screen.getByText(/Kunde oder Objekt konnten nicht geladen werden/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nur abschließen" })).toBeDisabled();
  });
});
