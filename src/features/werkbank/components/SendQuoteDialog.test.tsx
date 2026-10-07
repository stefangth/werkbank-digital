import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { profile, items, contacts, customer, actions, toast } = vi.hoisted(() => ({
  profile: { data: null as unknown, isError: false },
  items: { data: [] as unknown[] },
  contacts: { data: [] as unknown[] },
  customer: { data: null as unknown },
  actions: {
    preview: { mutateAsync: vi.fn(), isPending: false },
    send: { mutateAsync: vi.fn(), isPending: false },
    resend: { mutateAsync: vi.fn(), isPending: false },
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("../hooks/useCompanyProfile", () => ({ useCompanyProfile: () => profile }));
vi.mock("../hooks/useDocumentItems", () => ({ useDocumentItems: () => items }));
vi.mock("../hooks/useContacts", () => ({ useContacts: () => contacts }));
vi.mock("../hooks/useCustomers", () => ({ useCustomer: () => customer }));
vi.mock("../hooks/useQuoteActions", () => ({ useQuoteActions: () => actions }));

import { QuoteActionError } from "../data/quoteActions";
import { SendQuoteDialog } from "./SendQuoteDialog";

const COMPLETE = {
  company_name: "Muster GmbH", street: "Weg 1", postal_code: "01067", city: "Dresden",
  email: "info@muster.de", tax_number: "123", vat_id: null,
};
const quote = (over: Record<string, unknown> = {}) => ({
  id: "q1", customer_id: "c1", property_id: null, contact_id: "k1", status: "draft",
  valid_until: "2999-01-01", quote_no: 7, version: 1, ...over,
});

const renderDialog = (q = quote(), onOpenChange = vi.fn(), onResend = vi.fn()) =>
  renderWithProviders(<SendQuoteDialog quote={q as never} open onOpenChange={onOpenChange} onResend={onResend} />, {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never },
  });

describe("SendQuoteDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    profile.data = COMPLETE;
    profile.isError = false;
    items.data = [{ id: "i1", kind: "item" }];
    contacts.data = [{ id: "k1", email: "kontakt@example.de" }];
    customer.data = { id: "c1", email: "kunde@example.de" };
    actions.send.mutateAsync.mockResolvedValue({ emailSent: true });
    actions.resend.mutateAsync.mockResolvedValue({ emailSent: true });
    actions.preview.mutateAsync.mockResolvedValue(undefined);
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("prefills the contact email", () => {
    renderDialog();
    expect(screen.getByLabelText("An")).toHaveValue("kontakt@example.de");
  });

  it("falls back to the customer email when the contact has none", () => {
    contacts.data = [{ id: "k1", email: null }];
    renderDialog();
    expect(screen.getByLabelText("An")).toHaveValue("kunde@example.de");
  });

  it("lists each blocker and disables Senden", () => {
    profile.data = { ...COMPLETE, tax_number: null };
    items.data = [{ id: "t1", kind: "title" }];
    renderDialog(quote({ valid_until: "2000-01-01" }));
    expect(screen.getByText(/Firmendaten sind unvollständig/)).toBeInTheDocument();
    expect(screen.getByText(/keine Position/)).toBeInTheDocument();
    expect(screen.getByText(/nicht mehr gültig|Gültigkeitsdatum/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled();
  });

  it("flags a missing recipient", () => {
    contacts.data = [];
    customer.data = { id: "c1", email: null };
    renderDialog();
    expect(screen.getByText(/Empfänger/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled();
  });

  it("sends and toasts success", async () => {
    const onOpenChange = vi.fn();
    renderDialog(quote(), onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(actions.send.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: "q1", body: expect.objectContaining({ to: ["kontakt@example.de"], cc: [] }) }),
    ));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Das Angebot wurde versendet."));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers Erneut senden when the email did not go out", async () => {
    actions.send.mutateAsync.mockResolvedValue({ emailSent: false });
    const onResend = vi.fn();
    renderDialog(quote(), vi.fn(), onResend);
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [message, opts] = toast.warning.mock.calls[0];
    expect(message).toMatch(/E-Mail/);
    expect(opts.action.label).toBe("Erneut senden");
    opts.action.onClick();
    expect(onResend).toHaveBeenCalled();
  });

  it("shows the edge blockers inline when the server rejects the send", async () => {
    actions.send.mutateAsync.mockRejectedValue(new QuoteActionError("preflight_failed", ["no_items"]));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    expect(await screen.findByText(/keine Position/)).toBeInTheDocument();
  });

  it("shows the generic retry copy for a technical failure", async () => {
    actions.send.mutateAsync.mockRejectedValue(new QuoteActionError("render_failed"));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    expect(await screen.findByText(/Bitte versuche es noch einmal/)).toBeInTheDocument();
  });

  it("shows the load error instead of a profile blocker when the profile fails to load", () => {
    profile.data = undefined;
    profile.isError = true;
    renderDialog();
    expect(screen.getByText(/Firmendaten konnten nicht geladen/)).toBeInTheDocument();
    expect(screen.queryByText(/Firmendaten sind unvollständig/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled();
  });

  it("Vorschau opens the tab first, then calls the preview action", async () => {
    const tab = { closed: false, close: vi.fn(), location: { href: "" } };
    vi.stubGlobal("open", vi.fn(() => tab));
    actions.preview.mutateAsync.mockResolvedValue("blob:pdf");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Vorschau" }));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(actions.preview.mutateAsync).toHaveBeenCalledWith("q1"));
    await waitFor(() => expect(tab.location.href).toBe("blob:pdf"));
    vi.unstubAllGlobals();
  });

  it("opens in resend mode for a sent quote and warns that old links stop working", async () => {
    renderDialog(quote({ status: "sent" }));
    expect(screen.getByText(/Alte Links funktionieren danach nicht mehr/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vorschau" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erneut senden" }));
    await waitFor(() => expect(actions.resend.mutateAsync).toHaveBeenCalled());
    expect(actions.send.mutateAsync).not.toHaveBeenCalled();
  });
});
