import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/i18n";

const state = vi.hoisted(() => ({ reports: [] as unknown[] | undefined }));
const note = vi.hoisted(() => ({ mutate: vi.fn() }));
const pdf = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const tab = vi.hoisted(() => ({ openPendingTab: vi.fn(), showInTab: vi.fn() }));
vi.mock("../hooks/useVisitReports", () => ({
  useVisitReports: () => ({ data: state.reports }),
  useUpdateOfficeNote: () => note,
  useVisitReportPdf: () => pdf,
}));
vi.mock("../lib/pdfTab", () => tab);
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("../hooks/useAssignments", () => ({
  useVisitObjectUrls: () => ({ data: { "o/p1.jpg": "https://signed/p1.jpg", "o/sig.png": "https://signed/sig.png" } }),
}));

import i18n from "@/i18n";
import { VisitReportsCard } from "./VisitReportsCard";

const report = (over: Record<string, unknown> = {}) => ({
  id: "r1", visit_date: "2026-10-07", technician_name: "Anna Berg", body: "Ventil getauscht", office_note: null,
  locked_at: null, signed_at: null, signer_name: null, signature_path: null, photos: [], ...over,
});

describe("VisitReportsCard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("de");
  });

  it("renders nothing without reports", () => {
    state.reports = [];
    const { container } = render(<VisitReportsCard orderId="o1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows date, technician, text and an open pill", () => {
    state.reports = [report()];
    render(<VisitReportsCard orderId="o1" />);
    expect(screen.getByText("Anna Berg")).toBeInTheDocument();
    expect(screen.getByText("Ventil getauscht")).toBeInTheDocument();
    expect(screen.getByText("offen")).toBeInTheDocument();
  });

  it("shows a closed and a signed report with signer, time and signature", () => {
    state.reports = [
      report({ id: "r1", locked_at: "2026-10-07T10:00:00Z" }),
      report({ id: "r2", locked_at: "2026-10-07T11:00:00Z", signed_at: "2026-10-07T11:00:00Z", signer_name: "Frau Meier", signature_path: "o/sig.png" }),
    ];
    render(<VisitReportsCard orderId="o1" />);
    expect(screen.getByText("abgeschlossen")).toBeInTheDocument();
    expect(screen.getByText("unterschrieben")).toBeInTheDocument();
    expect(screen.getByText(/Unterschrieben von Frau Meier am/)).toBeInTheDocument();
    expect(screen.getByText(/Abgeschlossen am/)).toBeInTheDocument();
    expect(screen.getByAltText("Unterschrift von Frau Meier")).toHaveAttribute("src", "https://signed/sig.png");
  });

  it("opens a photo in a dialog", () => {
    state.reports = [report({ photos: [{ id: "p1", path: "o/p1.jpg", position: 0 }] })];
    render(<VisitReportsCard orderId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Foto 1" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByAltText("Foto 1")).toHaveAttribute("src", "https://signed/p1.jpg");
  });

  it("saves the internal note on blur only when changed", () => {
    state.reports = [report({ office_note: "alt" })];
    render(<VisitReportsCard orderId="o1" />);
    const field = screen.getByRole("textbox", { name: "Interne Notiz" });
    fireEvent.blur(field);
    expect(note.mutate).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "neu" } });
    fireEvent.blur(field);
    expect(note.mutate).toHaveBeenCalledWith({ reportId: "r1", note: "neu" });
  });

  it("opens the PDF of all reports or of one from the menu", async () => {
    state.reports = [report({ id: "r1" }), report({ id: "r2", visit_date: "2026-10-08", technician_name: "Ben Kurz" })];
    const pending = { closed: false } as unknown as Window;
    tab.openPendingTab.mockReturnValue(pending);
    pdf.mutateAsync.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
    URL.createObjectURL = vi.fn(() => "blob:pdf");
    render(<VisitReportsCard orderId="o1" />);
    const trigger = screen.getByRole("button", { name: "PDF" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Alle Berichte" }));
    await vi.waitFor(() => expect(tab.showInTab).toHaveBeenCalledWith(pending, "blob:pdf", expect.any(Function)));
    expect(pdf.mutateAsync).toHaveBeenCalledWith(undefined);

    fireEvent.keyDown(screen.getByRole("button", { name: "PDF" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Ben Kurz/ }));
    await vi.waitFor(() => expect(pdf.mutateAsync).toHaveBeenCalledWith(["r2"]));
  });

  it.each([
    ["preflight_failed", "Deine Firmendaten sind unvollständig. Ergänze sie in den Einstellungen und versuche es noch einmal."],
    ["no_reports", "Zu diesem Auftrag gibt es keinen passenden Einsatzbericht mehr. Lade die Seite neu."],
  ])("shows a specific toast for %s and closes the pending tab", async (code, message) => {
    const { VisitReportPdfError } = await import("../data/visitReports");
    state.reports = [report()];
    const pending = { close: vi.fn() } as unknown as Window;
    tab.openPendingTab.mockReturnValue(pending);
    pdf.mutateAsync.mockRejectedValue(new VisitReportPdfError(code));
    render(<VisitReportsCard orderId="o1" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "PDF" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Alle Berichte" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
    expect(pending.close).toHaveBeenCalled();
  });
});
