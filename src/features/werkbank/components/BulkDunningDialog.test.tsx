import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { issue } = vi.hoisted(() => ({ issue: { mutateAsync: vi.fn(), isPending: false } }));
vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("../hooks/useDunningActions", () => ({ useIssueDunning: () => issue }));

import { DunningActionError } from "../data/dunningActions";
import { BulkDunningDialog } from "./BulkDunningDialog";

const row = (id: string, no: string, over: Record<string, unknown> = {}) => ({
  invoice_id: id, invoice_no: no, customer_name: "Muster HV", next_stage: 1, open_amount: 119, days_overdue: 20,
  customer_invoice_email: "rechnung@example.de", customer_email: null, contact_email: null, ...over,
});

describe("BulkDunningDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = (rows: unknown[]) => renderWithProviders(<BulkDunningDialog rows={rows as never} onOpenChange={vi.fn()} />);

  it("names the count and the recipients, and excludes rows without an address", () => {
    render([row("a", "RE-1"), row("b", "RE-2", { customer_invoice_email: null })]);
    expect(screen.getByText(/1 Mahnung wird versendet/)).toBeInTheDocument();
    expect(screen.getByText("rechnung@example.de")).toBeInTheDocument();
    expect(screen.getByText(/Ohne E-Mail-Adresse, nicht dabei/)).toHaveTextContent("RE-2");
  });

  it("sends one after another and summarises sent, skipped and failed with links to the failures", async () => {
    issue.mutateAsync
      .mockResolvedValueOnce({ noticeId: "n1", stage: 1, sent: true })
      .mockRejectedValueOnce(new DunningActionError("not_allowed", ["nothing_open"]))
      .mockRejectedValueOnce(new DunningActionError("send_failed", [], true));
    render([row("a", "RE-1"), row("b", "RE-2"), row("c", "RE-3")]);
    fireEvent.click(screen.getByRole("button", { name: "Jetzt mahnen" }));
    expect(await screen.findByText("1 versendet, 1 übersprungen, 1 fehlgeschlagen")).toBeInTheDocument();
    expect(issue.mutateAsync.mock.calls.map((c) => c[0])).toEqual([
      { invoiceId: "a", delivery: "email", send: {} },
      { invoiceId: "b", delivery: "email", send: {} },
      { invoiceId: "c", delivery: "email", send: {} },
    ]);
    expect(screen.getByRole("link", { name: "RE-3" })).toHaveAttribute("href", "/invoices/c");
    expect(screen.queryByRole("link", { name: "RE-2" })).not.toBeInTheDocument();
  });

  it("treats any other error as failed", async () => {
    issue.mutateAsync.mockRejectedValueOnce(new Error("boom"));
    render([row("a", "RE-1")]);
    fireEvent.click(screen.getByRole("button", { name: "Jetzt mahnen" }));
    await waitFor(() => expect(screen.getByText("1 fehlgeschlagen")).toBeInTheDocument());
  });
});
