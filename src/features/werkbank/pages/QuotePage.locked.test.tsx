import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { client, toastError } = vi.hoisted(() => ({ client: {} as Record<string, unknown>, toastError: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useParams: () => ({ id: "q1" }) }));
vi.mock("../components/LineItemsEditor", () => ({
  LineItemsEditor: ({ readOnly }: { readOnly: boolean }) => <div data-testid="items" data-readonly={String(readOnly)} />,
}));
vi.mock("../components/CustomerPicker", () => ({ CustomerPicker: () => <div /> }));
vi.mock("../components/PropertyPicker", () => ({ PropertyPicker: () => <div /> }));
vi.mock("../components/ContactSelect", () => ({ ContactSelect: () => <div /> }));

import { QuotePage } from "./QuotePage";

const quoteRow = (status: string) => ({
  id: "q1", org_id: "org-1", quote_no: "A-0042", version: 1, status, customer_id: "k1", property_id: null, contact_id: null,
  location_note: null, subject: "Heizung", discount_percent: 0, intro_text: null, closing_text: null, payment_terms_text: null,
  valid_until: "2026-12-01", sent_at: null, sent_to: null, link_revoked_at: null, superseded_by: null,
});

describe("QuotePage when the quote was sent in the meantime", () => {
  let status = "draft";
  let quoteReads = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    status = "draft";
    quoteReads = 0;
    const base = createFakeSupabase({
      "werkbank.quote_list": { data: [], error: null },
      "werkbank.document_totals": { data: null, error: null },
      "werkbank.customers": { data: { id: "k1", kind: "property_manager" }, error: null },
    });
    // The quotes table: reads follow `status`; the first save finds the quote already sent and is
    // rejected by the database trigger.
    const quotes = {
      select: () => quotes,
      eq: () => quotes,
      update: () => ({
        eq: () => {
          status = "sent";
          return Promise.resolve({ error: { code: "P0001", message: "quote_locked" } });
        },
      }),
      maybeSingle: () => {
        quoteReads += 1;
        return Promise.resolve({ data: quoteRow(status), error: null });
      },
    };
    const schema = base.schema.bind(base);
    Object.assign(client, base, {
      schema: (name: string) => ({ ...schema(name), from: (table: string) => (table === "quotes" ? quotes : schema(name).from(table)) }),
    });
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  it("refetches the quote, shows errors.quoteLocked and turns read only", async () => {
    renderWithProviders(<MemoryRouter><QuotePage /></MemoryRouter>, {
      authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: (() => true) as never },
    });
    const subject = await screen.findByRole("textbox", { name: "Betreff" });
    expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "false");
    const readsBefore = quoteReads;

    fireEvent.change(subject, { target: { value: "Bad" } });
    fireEvent.blur(subject);

    const message = "Dieses Angebot ist kein Entwurf mehr und kann nicht geändert werden.";
    expect(await screen.findByText(message)).toBeInTheDocument();
    await waitFor(() => expect(quoteReads).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(screen.getByTestId("items")).toHaveAttribute("data-readonly", "true"));
    expect(screen.queryByRole("textbox", { name: "Betreff" })).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith(message);
  });
});
