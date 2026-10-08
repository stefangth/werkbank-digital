import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { st, issue, preview, sendM, download, setHold, clearHold, toast, pdf } = vi.hoisted(() => ({
  st: { balance: null as unknown, notices: [] as unknown[], hold: null as unknown },
  issue: { mutateAsync: vi.fn(), isPending: false },
  preview: { mutateAsync: vi.fn(), isPending: false },
  sendM: { mutateAsync: vi.fn(), isPending: false },
  download: { mutateAsync: vi.fn(), isPending: false },
  setHold: { mutateAsync: vi.fn(), isPending: false },
  clearHold: { mutateAsync: vi.fn(), isPending: false },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  pdf: { tab: { close: vi.fn() }, showInTab: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("../hooks/useOpenItems", () => ({
  useInvoiceBalance: () => ({ data: st.balance, isLoading: false, isError: false }),
  useDunningNotices: () => ({ data: st.notices, isLoading: false, isError: false }),
  useDunningHold: () => ({ data: st.hold, isLoading: false, isError: false }),
  useSetDunningHold: () => setHold,
  useClearDunningHold: () => clearHold,
}));
vi.mock("../hooks/useDunningActions", () => ({
  useIssueDunning: () => issue,
  usePreviewDunning: () => preview,
  useSendDunning: () => sendM,
  useDunningDownload: () => download,
}));
vi.mock("../lib/pdfTab", () => ({ openPendingTab: () => pdf.tab, showInTab: (...a: unknown[]) => pdf.showInTab(...a) }));
vi.mock("../hooks/useCustomers", () => ({ useCustomer: () => ({ data: { id: "c1", email: "kunde@example.de", invoice_email: "rechnung@example.de" } }) }));
vi.mock("../hooks/useContacts", () => ({ useContacts: () => ({ data: [] }) }));
vi.mock("../hooks/useCompanyProfile", () => ({ useCompanyProfile: () => ({ data: { dunning_deadline_days: 7 } }) }));

import { DunningActionError } from "../data/dunningActions";
import { DunningCard } from "./DunningCard";

const inv = (over: Record<string, unknown> = {}) => ({ id: "i1", customer_id: "c1", contact_id: null, status: "issued", type: "invoice", due_date: "2026-09-01", ...over });
const notice = (over: Record<string, unknown> = {}) => ({
  id: "n1", invoice_id: "i1", stage: 1, notice_date: "2026-09-15", payment_deadline: "2026-09-22", delivery: "email",
  sent_to: ["rechnung@example.de"], sent_at: "2026-09-15T10:00:00Z", pdf_path: "n1.pdf", ...over,
});

describe("DunningCard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    st.balance = { invoice_id: "i1", open_amount: 100, claim: 100, paid: 0, written_off: 0 };
    st.notices = [];
    st.hold = null;
    issue.mutateAsync.mockResolvedValue({ noticeId: "n9", stage: 1, sent: true });
    preview.mutateAsync.mockResolvedValue(new Blob(["x"]));
    sendM.mutateAsync.mockResolvedValue(undefined);
    download.mutateAsync.mockResolvedValue("https://files/n1.pdf");
    setHold.mutateAsync.mockResolvedValue(undefined);
    clearHold.mutateAsync.mockResolvedValue(undefined);
    URL.createObjectURL = vi.fn(() => "blob:x");
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  const render = (over: Record<string, unknown> = {}) => renderWithProviders(<DunningCard invoice={inv(over)} />);

  it("disables the create button for a paid invoice", () => {
    st.balance = { invoice_id: "i1", open_amount: 0 };
    render();
    expect(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" })).toBeDisabled();
  });

  it("disables the create button before the due date and names not_overdue", async () => {
    vi.useRealTimers();
    render({ due_date: "2099-01-01" });
    const btn = screen.getByRole("button", { name: "Zahlungserinnerung erstellen" });
    expect(btn).toBeDisabled();
    fireEvent.pointerMove(btn.closest("span")!, { pointerType: "mouse" });
    expect((await screen.findAllByText("Die Rechnung ist noch nicht überfällig.")).length).toBeGreaterThan(0);
  });

  it("labels the next stage after one notice", () => {
    st.notices = [notice()];
    render();
    expect(screen.getByRole("button", { name: "1. Mahnung erstellen" })).toBeEnabled();
    expect(screen.getByText("Zahlungserinnerung")).toBeInTheDocument();
  });

  it("presets recipient and deadline in the dialog", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" }));
    expect(await screen.findByRole("textbox", { name: /Empfänger/ })).toHaveValue("rechnung@example.de");
    expect(screen.getByRole("button", { name: /Zahlungsfrist/ })).toHaveTextContent("15/10/2026");
  });

  it("creates a print-only notice without send", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Nur PDF für Postversand" }));
    await waitFor(() => expect(issue.mutateAsync).toHaveBeenCalledWith({ invoiceId: "i1", delivery: "print", paymentDeadline: "2026-10-15" }));
    expect(toast.success).toHaveBeenCalled();
  });

  it("creates and sends by email to the typed recipients", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /CC/ }), { target: { value: "chef@example.de" } });
    fireEvent.click(screen.getByRole("button", { name: "Erstellen und senden" }));
    await waitFor(() => expect(issue.mutateAsync).toHaveBeenCalledWith({
      invoiceId: "i1", delivery: "email", paymentDeadline: "2026-10-15", send: { to: ["rechnung@example.de"], cc: ["chef@example.de"] },
    }));
  });

  it("opens the preview in a tab", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Vorschau" }));
    await waitFor(() => expect(pdf.showInTab).toHaveBeenCalled());
    expect(preview.mutateAsync).toHaveBeenCalledWith({ invoiceId: "i1", paymentDeadline: "2026-10-15" });
  });

  it("says created but not sent when the mail fails, and the list offers Erneut senden", async () => {
    issue.mutateAsync.mockRejectedValue(new DunningActionError("send_failed", [], true));
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Erstellen und senden" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("Erstellt, Versand fehlgeschlagen")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lists server blockers inside the dialog", async () => {
    issue.mutateAsync.mockRejectedValue(new DunningActionError("not_allowed", ["on_hold", "nothing_open"]));
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Erstellen und senden" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Für diese Rechnung ist die Mahnung gesperrt.")).toBeInTheDocument();
    expect(within(alert).getByText("Es ist nichts mehr offen.")).toBeInTheDocument();
  });

  it("resends an unsent email notice from the list", async () => {
    st.notices = [notice({ sent_at: null })];
    render();
    expect(screen.getByText("Versand fehlgeschlagen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erneut senden" }));
    await waitFor(() => expect(sendM.mutateAsync).toHaveBeenCalledWith({ noticeId: "n1", to: ["rechnung@example.de"] }));
  });

  it("opens a stored PDF", async () => {
    st.notices = [notice()];
    render();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(download.mutateAsync).toHaveBeenCalledWith("n1"));
    expect(pdf.showInTab).toHaveBeenCalledWith(pdf.tab, "https://files/n1.pdf", expect.any(Function));
  });

  it("sets a hold with a reason and no date", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Mahnsperre setzen" }));
    expect(await screen.findByRole("img", { name: "Ohne Datum gilt die Sperre, bis Du sie aufhebst." })).toBeInTheDocument();
    fireEvent.change(await screen.findByRole("textbox", { name: /Grund/ }), { target: { value: "Ratenzahlung" } });
    fireEvent.click(screen.getByRole("button", { name: "Sperre setzen" }));
    await waitFor(() => expect(setHold.mutateAsync).toHaveBeenCalledWith({ invoiceId: "i1", reason: "Ratenzahlung", until: null }));
  });

  it("shows the active hold banner and clears it", async () => {
    st.hold = { invoice_id: "i1", reason: "Ratenzahlung", until: null };
    render();
    expect(screen.getByText(/Ratenzahlung/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zahlungserinnerung erstellen" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Aufheben" }));
    await waitFor(() => expect(clearHold.mutateAsync).toHaveBeenCalledWith("i1"));
  });

  it("shows notices read only for a cancelled invoice", () => {
    st.notices = [notice()];
    st.hold = { invoice_id: "i1", reason: "x", until: null };
    render({ status: "cancelled" });
    expect(screen.getByText("Zahlungserinnerung")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /erstellen$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mahnsperre setzen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aufheben" })).not.toBeInTheDocument();
  });
});
