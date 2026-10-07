import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, navigate, mut, orderMut } = vi.hoisted(() => {
  const m = () => ({ mutate: vi.fn(), isPending: false });
  return {
    orderMut: { createFromQuote: m() },
    state: { orderId: null as string | null | undefined, orderError: false, refetchOrder: vi.fn(), quote: null as unknown, list: [] as unknown[], acceptances: [] as unknown[], customerKind: "property_manager" },
    navigate: vi.fn(),
    mut: { update: m(), remove: m(), extend: m(), revokeLink: m(), revise: m(), copy: m(), create: m() },
  };
});
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
  useParams: () => ({ id: "q1" }),
}));
vi.mock("../hooks/useQuotes", () => ({
  useQuote: () => ({ data: state.quote, isLoading: false, isError: false, refetch: vi.fn() }),
  useQuoteList: () => ({ data: state.list }),
  useQuoteMutations: () => mut,
}));
vi.mock("../hooks/useOrders", () => ({
  useOrderIdForQuote: () => ({ data: state.orderId, isError: state.orderError, refetch: state.refetchOrder }),
  useOrderMutations: () => orderMut,
}));
vi.mock("../hooks/useCustomers", () => ({ useCustomer: () => ({ data: { id: "k1", kind: state.customerKind } }) }));
vi.mock("../hooks/useQuoteHistory", () => ({
  useQuoteAcceptances: () => ({ data: state.acceptances }),
  useSignatureUrl: (path: string | null) => ({ data: path ? `https://signed/${path}` : undefined }),
}));
vi.mock("../components/LineItemsEditor", () => ({
  LineItemsEditor: ({ readOnly }: { readOnly: boolean }) => <div data-testid="items" data-readonly={String(readOnly)} />,
}));
vi.mock("../components/DocumentTotalsCard", () => ({
  DocumentTotalsCard: ({ isPrivateCustomer }: { isPrivateCustomer: boolean }) => <div data-testid="totals" data-private={String(isPrivateCustomer)} />,
}));
vi.mock("../components/CustomerPicker", () => ({ CustomerPicker: () => <div>test-customer-picker</div> }));
vi.mock("../components/PropertyPicker", () => ({ PropertyPicker: () => <div>test-property-picker</div> }));
vi.mock("../components/ContactSelect", () => ({ ContactSelect: () => <div>test-contact-select</div> }));

import { QuotePage } from "./QuotePage";
import { QUOTES_PATH, orderPath, quotePath } from "../paths";

const quote = (over: Record<string, unknown> = {}) => ({
  id: "q1", org_id: "org-1", quote_no: "A-0042", version: 1, status: "draft", customer_id: "k1", property_id: null, contact_id: null,
  location_note: null, subject: "Heizung", discount_percent: 0, intro_text: "Hallo", closing_text: null, payment_terms_text: null,
  valid_until: "2026-12-01", sent_at: null, sent_to: null, link_revoked_at: null, superseded_by: null, totals: null, ...over,
});
const listRow = (over: Record<string, unknown>) => ({ id: "q1", quote_no: "A-0042", version: 1, customer_name: "Muster HV", property_name: null, ...over });

describe("QuotePage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.quote = quote();
    state.list = [listRow({})];
    state.acceptances = [];
    state.orderId = null;
    state.orderError = false;
    state.customerKind = "property_manager";
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = () =>
    renderWithProviders(<MemoryRouter><QuotePage /></MemoryRouter>, {
      authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never },
    });

  it("shows an editable header and editor for a draft", async () => {
    render();
    expect(await screen.findByRole("textbox", { name: "Betreff" })).toBeEnabled();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "false");
    for (const name of ["Überarbeiten", "Kopieren", "Verlängern", "Link sperren"]) {
      expect(screen.queryByRole("button", { name: name })).not.toBeInTheDocument();
    }
  });

  it("saves a changed text field on blur and skips an unchanged one", async () => {
    render();
    const subject = await screen.findByRole("textbox", { name: "Betreff" });
    fireEvent.blur(subject);
    expect(mut.update.mutate).not.toHaveBeenCalled();
    fireEvent.change(subject, { target: { value: "Bad" } });
    fireEvent.blur(subject);
    expect(mut.update.mutate.mock.calls[0][0]).toEqual({ id: "q1", patch: { subject: "Bad" } });
  });

  it("is read only once sent, and offers Überarbeiten, Kopieren, Verlängern and Link sperren", async () => {
    state.quote = quote({ status: "sent", sent_at: "2026-10-01T10:00:00Z", sent_to: ["a@b.de"] });
    render();
    await screen.findByRole("button", { name: "Überarbeiten" });
    expect(screen.queryByRole("textbox", { name: "Betreff" })).not.toBeInTheDocument();
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "true");
    for (const name of ["Kopieren", "Verlängern", "Link sperren"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("revises into the new version and navigates to it", async () => {
    state.quote = quote({ status: "sent" });
    mut.revise.mutate.mockImplementation((_id, opts) => opts.onSuccess("q2"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Überarbeiten" }));
    expect(mut.revise.mutate.mock.calls[0][0]).toBe("q1");
    expect(navigate).toHaveBeenCalledWith(quotePath("q2"));
  });

  it("revises a rejected quote too, but offers neither Verlängern nor Link sperren", async () => {
    state.quote = quote({ status: "rejected" });
    mut.revise.mutate.mockImplementation((_id, opts) => opts.onSuccess("q9"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Überarbeiten" }));
    expect(mut.revise.mutate.mock.calls[0][0]).toBe("q1");
    expect(navigate).toHaveBeenCalledWith(quotePath("q9"));
    expect(screen.queryByRole("button", { name: "Verlängern" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link sperren" })).not.toBeInTheDocument();
  });

  it("does not show the page mini on the detail page", async () => {
    render();
    await screen.findByRole("textbox", { name: "Betreff" });
    expect(screen.queryByRole("region", { name: "So funktionieren Angebote" })).not.toBeInTheDocument();
  });

  it("shows Abgelaufen from its own date while the list row is missing", async () => {
    state.quote = quote({ status: "sent", valid_until: "2020-01-01" });
    state.list = [];
    render();
    expect(await screen.findByText("Abgelaufen")).toBeInTheDocument();
  });

  it("copies into a new draft and navigates to it", async () => {
    state.quote = quote({ status: "sent" });
    mut.copy.mutate.mockImplementation((_v, opts) => opts.onSuccess("q3"));
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Kopieren" }));
    expect(mut.copy.mutate.mock.calls[0][0]).toEqual({ id: "q1" });
    expect(navigate).toHaveBeenCalledWith(quotePath("q3"));
  });

  it("shows the discount of a read only quote with a percent sign", async () => {
    state.quote = quote({ status: "sent", discount_percent: 2.5 });
    render();
    expect(await screen.findByText("2,5 %")).toBeInTheDocument();
  });

  it("shows an error with retry when the order lookup fails, instead of neither action", async () => {
    state.quote = quote({ status: "accepted" });
    state.orderId = undefined;
    state.orderError = true;
    render();
    expect(await screen.findByText("Der Auftrag konnte nicht geprüft werden.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Auftrag anlegen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(state.refetchOrder).toHaveBeenCalled();
  });

  it("blocks the link of a sent quote, and hides the button for accepted and already blocked ones", async () => {
    state.quote = quote({ status: "sent" });
    const { unmount } = render();
    fireEvent.click(await screen.findByRole("button", { name: "Link sperren" }));
    // Blocking cannot be undone from the page, so it asks first.
    expect(mut.revokeLink.mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Link sperren?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(mut.revokeLink.mutate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Link sperren" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Link sperren" }));
    expect(mut.revokeLink.mutate.mock.calls[0][0]).toBe("q1");
    unmount();
    state.quote = quote({ status: "accepted" });
    const second = render();
    await screen.findByRole("button", { name: "Kopieren" });
    expect(screen.queryByRole("button", { name: "Link sperren" })).not.toBeInTheDocument();
    second.unmount();
    state.quote = quote({ status: "sent", link_revoked_at: "2026-10-02T00:00:00Z" });
    render();
    await screen.findByText("Link gesperrt");
    expect(screen.queryByRole("button", { name: "Link sperren" })).not.toBeInTheDocument();
  });

  it("extends the validity with the calendar, Monday first, only to a later day", async () => {
    state.quote = quote({ status: "sent", valid_until: "2026-12-10" });
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Verlängern" }));
    const grid = await screen.findByRole("grid");
    // 1 December 2026 is a Tuesday: Monday first means the grid starts with 30 November.
    expect(within(grid).getAllByRole("gridcell")[0]).toHaveTextContent("30");
    fireEvent.click(within(grid).getByText("20"));
    expect(mut.extend.mutate.mock.calls[0][0]).toEqual({ id: "q1", validUntil: "2026-12-20" });
  });

  it("cannot extend an already expired quote to a day before today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-15T10:00:00Z"));
    try {
      state.quote = quote({ status: "sent", valid_until: "2026-12-10" });
      render();
      fireEvent.click(await screen.findByRole("button", { name: "Verlängern" }));
      const grid = await screen.findByRole("grid");
      fireEvent.click(within(grid).getByText("12"));
      expect(mut.extend.mutate).not.toHaveBeenCalled();
      fireEvent.click(within(grid).getByText("15"));
      expect(mut.extend.mutate.mock.calls[0][0]).toEqual({ id: "q1", validUntil: "2026-12-15" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows nothing in the history for a draft", async () => {
    render();
    await screen.findByRole("textbox", { name: "Betreff" });
    expect(screen.queryByText("Verlauf")).not.toBeInTheDocument();
  });

  it("lists the sent entry and the decisions with the signature image", async () => {
    state.quote = quote({ status: "accepted", sent_at: "2026-10-01T10:00:00Z", sent_to: ["a@b.de", "c@d.de"] });
    state.acceptances = [
      { id: "a1", decision: "accepted", signer_name: "Anna Meier", decided_at: "2026-10-03T09:00:00Z", signature_image_path: "o/q1/sig.png", comment: "Passt so" },
    ];
    render();
    const history = (await screen.findByText("Verlauf")).closest("section")!;
    expect(within(history).getByText(/an a@b\.de, c@d\.de/)).toBeInTheDocument();
    expect(within(history).getByText(/von Anna Meier/)).toBeInTheDocument();
    expect(within(history).getByText("Passt so")).toBeInTheDocument();
    expect(within(history).getByRole("img", { name: "Unterschrift von Anna Meier" })).toHaveAttribute("src", "https://signed/o/q1/sig.png");
  });

  it("links the versions of a quote to each other", async () => {
    state.quote = quote({ version: 2 });
    state.list = [listRow({ id: "q1", version: 2 }), listRow({ id: "q0", version: 1 })];
    render();
    const link = await screen.findByRole("link", { name: "Version 1" });
    expect(link).toHaveAttribute("href", quotePath("q0"));
    expect(screen.queryByRole("link", { name: "Version 2" })).not.toBeInTheDocument();
  });

  it("passes whether the customer is private to the totals", async () => {
    state.customerKind = "private";
    render();
    expect(await screen.findByTestId("totals")).toHaveAttribute("data-private", "true");
  });

  it("deletes a draft after confirming, then returns to the list", async () => {
    mut.remove.mutate.mockImplementation((_id, opts) => opts.onSuccess());
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Entwurf löschen" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Löschen" }));
    expect(mut.remove.mutate.mock.calls[0][0]).toBe("q1");
    expect(navigate).toHaveBeenCalledWith(QUOTES_PATH);
  });

  describe("order of an accepted quote", () => {
    it("creates the order and opens it", async () => {
      state.quote = quote({ status: "accepted" });
      state.list = [listRow({ status: "accepted", has_order: false })];
      orderMut.createFromQuote.mutate.mockImplementation((_id, opts) => opts.onSuccess("o9"));
      render();
      fireEvent.click(await screen.findByRole("button", { name: "Auftrag anlegen" }));
      expect(orderMut.createFromQuote.mutate).toHaveBeenCalledWith("q1", expect.anything());
      expect(navigate).toHaveBeenCalledWith(orderPath("o9"));
    });

    it("links to the existing order instead", async () => {
      state.quote = quote({ status: "accepted" });
      state.list = [listRow({ status: "accepted", has_order: true })];
      state.orderId = "o5";
      render();
      expect(await screen.findByRole("link", { name: "Zum Auftrag" })).toHaveAttribute("href", orderPath("o5"));
      expect(screen.queryByRole("button", { name: "Auftrag anlegen" })).not.toBeInTheDocument();
    });

    it("offers neither action while the order lookup is still loading", async () => {
      state.quote = quote({ status: "accepted" });
      state.list = [];
      state.orderId = undefined;
      render();
      await screen.findByTestId("items");
      expect(screen.queryByRole("button", { name: "Auftrag anlegen" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Zum Auftrag" })).not.toBeInTheDocument();
    });

    it("offers nothing for a quote that is not accepted", async () => {
      state.quote = quote({ status: "sent" });
      render();
      await screen.findByTestId("items");
      expect(screen.queryByRole("button", { name: "Auftrag anlegen" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Zum Auftrag" })).not.toBeInTheDocument();
    });
  });
});
