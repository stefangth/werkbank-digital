import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/i18n";

const state = vi.hoisted(() => ({ reports: [] as unknown[] | undefined }));
const note = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../hooks/useVisitReports", () => ({
  useVisitReports: () => ({ data: state.reports }),
  useUpdateOfficeNote: () => note,
}));
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
});
