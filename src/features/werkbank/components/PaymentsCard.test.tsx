import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";
import { WerkbankDataError } from "../lib/dbErrors";

const { st, record, reverse, transfer, refetchBalance } = vi.hoisted(() => ({
  st: { balance: null as unknown, entries: [] as unknown[], targets: [] as unknown[], destinations: new Map() as Map<string, unknown> },
  record: { mutateAsync: vi.fn(), isPending: false },
  reverse: { mutateAsync: vi.fn(), isPending: false },
  transfer: { mutateAsync: vi.fn(), isPending: false },
  refetchBalance: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("../hooks/useOpenItems", () => ({
  useInvoiceBalance: () => ({ data: st.balance, isLoading: false, isError: false, refetch: refetchBalance }),
  useInvoiceEntries: () => ({ data: st.entries, isLoading: false, isError: false }),
  useRecordEntry: () => record,
  useReverseEntry: () => reverse,
  useTransferEntry: () => transfer,
  useTransferTargets: () => ({ data: st.targets }),
  useTransferDestinations: () => ({ data: st.destinations }),
}));

import { PaymentsCard } from "./PaymentsCard";

const balance = (over: Record<string, unknown> = {}) => ({
  invoice_id: "i1", claim: 1190.5, paid: 500, written_off: 0, open_amount: 690.5, payment_state: "partial", ...over,
});
const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1", invoice_id: "i1", kind: "payment", amount: 500, booked_on: "2026-10-01", note: null, write_off_reason: null,
  reversed_at: null, reversal_reason: null, transferred_from: null, created_at: "2026-10-01T10:00:00Z", ...over,
});

describe("PaymentsCard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    st.balance = balance();
    st.entries = [entry()];
    st.targets = [];
    st.destinations = new Map();
    record.mutateAsync.mockResolvedValue("new");
    reverse.mutateAsync.mockResolvedValue(undefined);
    transfer.mutateAsync.mockResolvedValue("new");
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  const render = (status = "issued") => renderWithProviders(<MemoryRouter><PaymentsCard invoiceId="i1" customerId="c1" status={status} /></MemoryRouter>);

  it("shows claim, paid, written off and open for a partly paid invoice", () => {
    render();
    for (const [label, value] of [["Forderung", "1.190,50"], ["Bezahlt", "500,00"], ["Ausgebucht", "0,00"], ["Offen", "690,50"]]) {
      expect(within(screen.getByText(label).parentElement!).getByText(new RegExp(value))).toBeInTheDocument();
    }
  });

  it("shows Guthaben instead of Offen for an overpaid invoice and offers a refund", () => {
    st.balance = balance({ paid: 1300.5, open_amount: -110, payment_state: "overpaid" });
    render();
    expect(screen.getAllByText("Guthaben").some((el) => /110,00/.test(el.parentElement!.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("Offen", { selector: "div.text-sm" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guthaben auszahlen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ausbuchen" })).not.toBeInTheDocument();
  });

  it("has no refund button without credit", () => {
    render();
    expect(screen.queryByRole("button", { name: "Guthaben auszahlen" })).not.toBeInTheDocument();
  });

  it("renders a reversed entry struck through with its reason", () => {
    st.entries = [entry({ reversed_at: "2026-10-02T10:00:00Z", reversal_reason: "Falsch gebucht" })];
    render();
    expect(screen.getByText(/Falsch gebucht/)).toBeInTheDocument();
    expect(screen.getByTestId("entry-e1")).toHaveClass("line-through");
    expect(screen.queryByRole("button", { name: "Stornieren" })).not.toBeInTheDocument();
  });

  it("presets Berlin today and the open amount in the payment dialog", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T22:30:00Z"));
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlung erfassen" }));
    expect(await screen.findByRole("textbox", { name: /Betrag/ })).toHaveValue("690,50");
    expect(screen.getByRole("button", { name: /Buchungsdatum/ })).toHaveTextContent("09/10/2026");
    expect(screen.getAllByRole("button", { name: /Heute\. Du kannst/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Der offene Betrag/ })).toHaveLength(1);
  });

  const openPayment = async (amount: string) => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlung erfassen" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Betrag/ }), { target: { value: amount } });
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Zahlung buchen" }));

  it("submits 1.190,50 as 1190.5", async () => {
    await openPayment("1.190,50");
    submit();
    await waitFor(() => expect(record.mutateAsync).toHaveBeenCalled());
    expect(record.mutateAsync.mock.calls[0][0]).toMatchObject({ invoiceId: "i1", kind: "payment", amount: 1190.5 });
  });

  it("shows a field error and does not submit for 12,345", async () => {
    await openPayment("12,345");
    submit();
    expect(await screen.findByText(/höchstens zwei Nachkommastellen/)).toBeInTheDocument();
    expect(record.mutateAsync).not.toHaveBeenCalled();
  });

  it("warns above the open amount and still submits", async () => {
    await openPayment("800");
    expect(await screen.findByText(/mehr als der offene Betrag/)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(record.mutateAsync).toHaveBeenCalled());
    expect(record.mutateAsync.mock.calls[0][0].amount).toBe(800);
  });

  it("writes off the open amount and requires a note for Sonstiges", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Ausbuchen" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/690,50/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Betrifft nur die offenen Posten in Werkbank/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sonstiges" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Ausbuchen" }));
    expect(await within(dialog).findByText(/Ergänze eine Notiz/)).toBeInTheDocument();
    expect(record.mutateAsync).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Notiz/ }), { target: { value: "Insolvenz" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ausbuchen" }));
    await waitFor(() => expect(record.mutateAsync).toHaveBeenCalled());
    expect(record.mutateAsync.mock.calls[0][0]).toMatchObject({ kind: "write_off", amount: 690.5, writeOffReason: "other", note: "Insolvenz" });
  });

  it("shows the changed amount message and refetches on open_amount_changed", async () => {
    record.mutateAsync.mockRejectedValue(new WerkbankDataError("P0001", "open_amount_changed"));
    await openPayment("100");
    submit();
    expect(await screen.findByText(/offene Betrag hat sich zwischenzeitlich geändert/)).toBeInTheDocument();
    expect(refetchBalance).toHaveBeenCalled();
  });

  it("shows the date hint in the write-off dialog", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Ausbuchen" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("button", { name: /Heute\. Du kannst/ })).toHaveLength(1);
  });

  it("replaces the amount preset with the refetched open amount after a stale error, keeping the note", async () => {
    record.mutateAsync.mockRejectedValue(new WerkbankDataError("P0001", "open_amount_changed"));
    refetchBalance.mockImplementation(() => { st.balance = balance({ open_amount: 300 }); });
    const view = render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlung erfassen" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Betrag/ }), { target: { value: "100" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Notiz/ }), { target: { value: "Bar" } });
    submit();
    await screen.findByText(/offene Betrag hat sich zwischenzeitlich geändert/);
    // The refetched balance arrives and re-renders the card (the real query does this itself).
    view.rerender(<MemoryRouter><PaymentsCard invoiceId="i1" customerId="c1" status="issued" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Betrag/ })).toHaveValue("300,00"));
    expect(screen.getByRole("textbox", { name: /Notiz/ })).toHaveValue("Bar");
  });

  it("syncs the amount once per stale error, so a later balance change keeps a typed amount", async () => {
    record.mutateAsync.mockRejectedValue(new WerkbankDataError("P0001", "open_amount_changed"));
    refetchBalance.mockImplementation(() => { st.balance = balance({ open_amount: 300 }); });
    const view = render();
    fireEvent.click(screen.getByRole("button", { name: "Zahlung erfassen" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Betrag/ }), { target: { value: "100" } });
    submit();
    await screen.findByText(/offene Betrag hat sich zwischenzeitlich geändert/);
    view.rerender(<MemoryRouter><PaymentsCard invoiceId="i1" customerId="c1" status="issued" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Betrag/ })).toHaveValue("300,00"));
    fireEvent.change(screen.getByRole("textbox", { name: /Betrag/ }), { target: { value: "250" } });
    st.balance = balance({ open_amount: 200 });
    view.rerender(<MemoryRouter><PaymentsCard invoiceId="i1" customerId="c1" status="issued" /></MemoryRouter>);
    await act(async () => {});
    expect(screen.getByRole("textbox", { name: /Betrag/ })).toHaveValue("250");
  });

  it("limits a refund to the credit", async () => {
    st.balance = balance({ open_amount: -110, payment_state: "overpaid" });
    render();
    fireEvent.click(screen.getByRole("button", { name: "Guthaben auszahlen" }));
    const amount = await screen.findByRole("textbox", { name: /Betrag/ });
    expect(amount).toHaveValue("110,00");
    fireEvent.change(amount, { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Auszahlung buchen" }));
    expect(await screen.findByText(/nicht höher sein als das Guthaben/)).toBeInTheDocument();
    expect(record.mutateAsync).not.toHaveBeenCalled();
  });

  it("lists same customer targets and submits the transfer with its reason", async () => {
    st.targets = [{ id: "i2", invoice_no: "RE-2", gross_total: 100 }];
    render();
    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("radio")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("radio"));
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Grund/ }), { target: { value: "Falsche Rechnung" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zahlung umbuchen" }));
    await waitFor(() => expect(transfer.mutateAsync).toHaveBeenCalled());
    expect(transfer.mutateAsync.mock.calls[0][0]).toEqual({ entryId: "e1", targetInvoiceId: "i2", reason: "Falsche Rechnung" });
  });

  it("reverses an entry with a reason", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Stornieren" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Grund/ }), { target: { value: "Doppelt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Buchung stornieren" }));
    await waitFor(() => expect(reverse.mutateAsync).toHaveBeenCalledWith({ entryId: "e1", reason: "Doppelt" }));
  });

  it("names the credit of a cancelled invoice and opens the transfer dialog for its payment", async () => {
    st.balance = balance({ claim: 0, paid: 500, open_amount: -500, payment_state: "overpaid" });
    st.targets = [{ id: "i2", invoice_no: "RE-2", gross_total: 100 }];
    render("cancelled");
    const notice = screen.getByText(/Zahlung auf die korrigierte Rechnung umbuchen/).closest("[role=alert]") as HTMLElement;
    expect(notice.textContent?.replace(/\s/g, " ")).toMatch(/^Guthaben 500,00 €\. Zahlung auf die korrigierte Rechnung umbuchen\?/);
    expect(screen.queryByRole("button", { name: "Zahlung erfassen" })).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole("button", { name: "Umbuchen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio"));
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Grund/ }), { target: { value: "Korrektur" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zahlung umbuchen" }));
    await waitFor(() => expect(transfer.mutateAsync).toHaveBeenCalledWith({ entryId: "e1", targetInvoiceId: "i2", reason: "Korrektur" }));
  });

  it("offers no transfer from the notice when no payment fits into the credit", () => {
    st.balance = balance({ claim: 0, paid: 200, open_amount: -200, payment_state: "overpaid" });
    st.entries = [entry({ amount: 500 }), entry({ id: "e2", kind: "refund", amount: 300 })];
    render("cancelled");
    const notice = screen.getByText(/Guthaben/, { selector: "[role=alert] *" }).closest("[role=alert]") as HTMLElement;
    expect(within(notice).queryByRole("button", { name: "Umbuchen" })).not.toBeInTheDocument();
  });

  it("links a transferred entry to the invoice it moved to", () => {
    st.entries = [entry({ reversed_at: "2026-10-02T10:00:00Z", reversal_reason: "Korrektur" })];
    st.destinations = new Map([["e1", { invoiceId: "i2", invoiceNo: "RE-0002" }]]);
    render("cancelled");
    const link = screen.getByRole("link", { name: /RE-0002/ });
    expect(link).toHaveAttribute("href", "/invoices/i2");
  });
});
