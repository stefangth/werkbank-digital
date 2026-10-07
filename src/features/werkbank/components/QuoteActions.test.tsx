import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { actions, toast } = vi.hoisted(() => ({
  actions: {
    preview: { mutateAsync: vi.fn(), isPending: false },
    send: { mutateAsync: vi.fn(), isPending: false },
    resend: { mutateAsync: vi.fn(), isPending: false },
    download: { mutateAsync: vi.fn(), isPending: false },
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("../hooks/useQuoteActions", () => ({ useQuoteActions: () => actions }));
vi.mock("./SendQuoteDialog", () => ({
  SendQuoteDialog: ({ quote }: { quote: { status: string } }) => <div>dialog:{quote.status}</div>,
}));

let tab: { closed: boolean; close: ReturnType<typeof vi.fn>; location: { href: string } };
import { QuoteActions } from "./QuoteActions";

const quote = (status: string, over: Record<string, unknown> = {}) => ({
  id: "q1", status,
  pdf_path: status === "draft" ? null : "org-1/quotes/q1.pdf",
  accepted_pdf_path: status === "accepted" ? "org-1/quotes/q1-accepted.pdf" : null,
  ...over,
}) as never;
const renderActions = (status: string, over: Record<string, unknown> = {}) =>
  renderWithProviders(<QuoteActions quote={quote(status, over)} />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } });

describe("QuoteActions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    actions.download.mutateAsync.mockResolvedValue("https://signed");
    actions.preview.mutateAsync.mockResolvedValue(undefined);
    tab = { closed: false, close: vi.fn(), location: { href: "" } };
    vi.stubGlobal("open", vi.fn(() => tab));
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("a draft opens the send dialog and can preview", async () => {
    renderActions("draft");
    fireEvent.click(screen.getByRole("button", { name: "Vorschau" }));
    await waitFor(() => expect(actions.preview.mutateAsync).toHaveBeenCalledWith("q1"));
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    expect(screen.getByText("dialog:draft")).toBeInTheDocument();
  });

  it("a sent quote resends in resend mode and downloads the sent PDF", async () => {
    renderActions("sent");
    fireEvent.click(screen.getByRole("button", { name: "Erneut senden" }));
    expect(screen.getByText("dialog:sent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(actions.download.mutateAsync).toHaveBeenCalledWith({ quoteId: "q1", kind: "sent" }));
    expect(tab.location.href).toBe("https://signed");
  });

  it("an accepted quote downloads the accepted PDF and cannot be resent", async () => {
    renderActions("accepted");
    expect(screen.queryByRole("button", { name: "Erneut senden" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(actions.download.mutateAsync).toHaveBeenCalledWith({ quoteId: "q1", kind: "accepted" }));
  });

  it.each(["rejected", "superseded"])("a %s quote still opens the sent PDF", async (status) => {
    renderActions(status);
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(actions.download.mutateAsync).toHaveBeenCalledWith({ quoteId: "q1", kind: "sent" }));
  });

  it("an accepted quote without an accepted PDF opens the sent one", async () => {
    renderActions("accepted", { accepted_pdf_path: null });
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(actions.download.mutateAsync).toHaveBeenCalledWith({ quoteId: "q1", kind: "sent" }));
  });

  it("offers no PDF while nothing was stored", () => {
    renderActions("draft");
    expect(screen.queryByRole("button", { name: "PDF" })).not.toBeInTheDocument();
  });

  it("toasts and closes the pre-opened tab when the PDF cannot be opened", async () => {
    actions.download.mutateAsync.mockRejectedValue(new Error("x"));
    renderActions("sent");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Das PDF konnte nicht geöffnet werden."));
    expect(tab.close).toHaveBeenCalled();
  });

  it("opens the tab before the PDF url resolves", async () => {
    let resolve!: (u: string) => void;
    actions.download.mutateAsync.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderActions("sent");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("");
    resolve("https://late");
    await waitFor(() => expect(tab.location.href).toBe("https://late"));
  });

  it("opens the tab before the preview resolves and closes it on error", async () => {
    let reject!: (e: Error) => void;
    actions.preview.mutateAsync.mockReturnValue(new Promise((_, r) => { reject = r; }));
    renderActions("draft");
    fireEvent.click(screen.getByRole("button", { name: "Vorschau" }));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.close).not.toHaveBeenCalled();
    reject(new Error("x"));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
  });

  it("offers a link when the browser blocked the tab", async () => {
    vi.stubGlobal("open", vi.fn(() => null));
    renderActions("sent");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Dein Browser hat den neuen Tab blockiert.", expect.anything()));
  });

  it("offers a rejected quote only its PDF", () => {
    renderActions("rejected");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["PDF"]);
  });
});
