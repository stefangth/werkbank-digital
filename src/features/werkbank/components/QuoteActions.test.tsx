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

import { QuoteActions } from "./QuoteActions";

const quote = (status: string) => ({ id: "q1", status }) as never;
const renderActions = (status: string) =>
  renderWithProviders(<QuoteActions quote={quote(status)} />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } });

describe("QuoteActions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    actions.download.mutateAsync.mockResolvedValue("https://signed");
    actions.preview.mutateAsync.mockResolvedValue(undefined);
    vi.stubGlobal("open", vi.fn());
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
    expect(window.open).toHaveBeenCalledWith("https://signed", "_blank");
  });

  it("an accepted quote downloads the accepted PDF and cannot be resent", async () => {
    renderActions("accepted");
    expect(screen.queryByRole("button", { name: "Erneut senden" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(actions.download.mutateAsync).toHaveBeenCalledWith({ quoteId: "q1", kind: "accepted" }));
  });

  it("toasts when the PDF cannot be opened", async () => {
    actions.download.mutateAsync.mockRejectedValue(new Error("x"));
    renderActions("sent");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Das PDF konnte nicht geöffnet werden."));
  });

  it("shows nothing for a rejected quote", () => {
    renderActions("rejected");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
