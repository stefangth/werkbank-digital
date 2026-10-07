import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/components/common/SignaturePad", () => ({
  SignaturePad: ({ onChange, labels }: { onChange: (v: unknown) => void; labels?: { legalName: string } }) => (
    <div>
      <span>{labels?.legalName}</span>
      <button type="button" onClick={() => onChange({ method: "typed", typedName: "Anna Muster" })}>signieren</button>
    </div>
  ),
}));

import { QuotePublicPage } from "./QuotePublicPage";

const TOKEN = "b".repeat(64);
const CONSENT = "Ich nehme das Angebot A-0042 in der hier angezeigten Fassung verbindlich an.";
const view = {
  quote: {
    quote_no: "A-0042", version: 1, number: "A-0042", status: "sent", date: "2026-10-07", valid_until: "2026-11-06",
    subject: "Badsanierung", intro: "Gerne bieten wir an.", closing: "Mit freundlichen Grüßen", payment_terms: "14 Tage netto",
    recipient_lines: ["Anna Muster", "Hauptstr. 1"], location_lines: ["Gartenweg 2"],
  },
  seller: { company_name: "Muster Sanitär GmbH", legal_form: null, street: "A", postal_code: "80331", city: "München", phone: null, email: null, website: null, logo_url: "https://x/logo.png" },
  items: [{
    title: "Bad", number: "1", subtotal: 100,
    rows: [{ kind: "item", number: "1.1", name: "Fliesen", description: "verlegen", quantity: 2, unit: "m²", unitPrice: 50, lineNet: 100 }],
  }],
  totals: { net: 100, discount: 0, discountPercent: 0, vat: [{ rate: 19, net: 100, vat: 19 }], gross: 119 },
  pdf_url: "https://x/sent.pdf",
  consent_text: CONSENT,
};
const fail = (status: number, body: unknown) => ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } });

let calls: { args: unknown[] }[];
function mount(responses: unknown[]) {
  const queue = [...responses];
  const fake = createFakeSupabase({});
  calls = fake.calls as never;
  fake.functions.invoke = ((name: string, opts?: { body?: unknown }) => {
    fake.calls.push({ table: `fn:${name}`, method: "invoke", args: [opts?.body] });
    return Promise.resolve(queue.shift());
  }) as never;
  Object.assign(client, fake);
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/quote/${TOKEN}`]}>
      <Routes><Route path="/quote/:token" element={<QuotePublicPage />} /></Routes>
    </MemoryRouter>,
  );
}
const decideCalls = () => calls.filter((c) => (c.args[0] as { action?: string })?.action === "decide");

beforeEach(() => { vi.clearAllMocks(); });

describe("QuotePublicPage", () => {
  it("renders logo, sections, totals and the pdf link of an open quote, without a session", async () => {
    mount([{ data: view, error: null }]);
    expect(await screen.findByText("Badsanierung")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Muster Sanitär GmbH" })).toHaveAttribute("src", "https://x/logo.png");
    expect(screen.getByText("Fliesen")).toBeInTheDocument();
    expect(screen.getAllByText(/119,00\s*€/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Angebot als PDF öffnen" })).toHaveAttribute("href", "https://x/sent.pdf");
    expect(screen.getByText(CONSENT)).toBeInTheDocument();
    expect(calls[0].args[0]).toEqual({ action: "view", token: TOKEN });
  });

  it.each([
    ["not_found", 404, "Link nicht gefunden"],
    ["superseded", 410, "Dieses Angebot wurde überarbeitet"],
    ["revoked", 410, "Dieser Link ist nicht mehr gültig"],
    ["expired", 410, "Dieses Angebot ist abgelehnt".replace("abgelehnt", "abgelaufen")],
  ])("shows its own message and no form for %s", async (code, status, title) => {
    mount([fail(status, { error: code })]);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Angebot verbindlich annehmen" })).not.toBeInTheDocument();
    expect(screen.queryByText("Es wurde nichts unterschrieben. Ihre Eingaben wurden nicht gespeichert.")).not.toBeInTheDocument();
  });

  it("shows the decided state with the accepted pdf", async () => {
    mount([fail(410, { error: "decided", decision: "accepted", pdf_url: "https://x/acc.pdf" })]);
    expect(await screen.findByText("Dieses Angebot wurde bereits angenommen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Angenommenes Angebot als PDF öffnen" })).toHaveAttribute("href", "https://x/acc.pdf");
  });

  it("enables accept only with name, signature and consent", async () => {
    mount([{ data: view, error: null }]);
    const button = await screen.findByRole("button", { name: "Angebot verbindlich annehmen" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ihr vollständiger Name"), { target: { value: "Anna Muster" } });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "signieren" }));
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
  });

  it("accepts and shows the thank-you state with the accepted pdf link", async () => {
    mount([{ data: view, error: null }, { data: { ok: true, pdf_url: "https://x/acc.pdf" }, error: null }]);
    fireEvent.change(await screen.findByLabelText("Ihr vollständiger Name"), { target: { value: "Anna Muster" } });
    fireEvent.click(screen.getByRole("button", { name: "signieren" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Angebot verbindlich annehmen" }));
    expect(await screen.findByText("Vielen Dank, das Angebot ist angenommen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Angenommenes Angebot als PDF öffnen" })).toHaveAttribute("href", "https://x/acc.pdf");
    expect(decideCalls()[0].args[0]).toEqual({
      action: "decide", token: TOKEN, decision: "accepted", signer_name: "Anna Muster",
      signature: { method: "typed", typedName: "Anna Muster" }, consent: true,
    });
  });

  it("swaps to the superseded state and says nothing was signed when decide answers 410 superseded", async () => {
    mount([{ data: view, error: null }, fail(410, { error: "superseded" })]);
    fireEvent.change(await screen.findByLabelText("Ihr vollständiger Name"), { target: { value: "Anna Muster" } });
    fireEvent.click(screen.getByRole("button", { name: "signieren" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Angebot verbindlich annehmen" }));
    expect(await screen.findByText("Dieses Angebot wurde überarbeitet")).toBeInTheDocument();
    expect(screen.getByText("Es wurde nichts unterschrieben. Ihre Eingaben wurden nicht gespeichert.").closest("[role='alert']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Angebot verbindlich annehmen" })).not.toBeInTheDocument();
    expect(screen.queryByText("Vielen Dank, das Angebot ist angenommen")).not.toBeInTheDocument();
  });

  it("keeps the form and shows the message for a 422 answer", async () => {
    mount([{ data: view, error: null }, fail(422, { error: "invalid_signer_name" })]);
    fireEvent.change(await screen.findByLabelText("Ihr vollständiger Name"), { target: { value: "Anna Muster" } });
    fireEvent.click(screen.getByRole("button", { name: "signieren" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Angebot verbindlich annehmen" }));
    const message = await screen.findByText("Bitte geben Sie Ihren vollständigen Namen an.");
    expect(screen.getByRole("button", { name: "Angebot verbindlich annehmen" })).toBeEnabled();
    // The error is announced and tied to the name field.
    expect(message.closest("[role='alert']")).not.toBeNull();
    const name = screen.getByLabelText("Ihr vollständiger Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Bitte geben Sie Ihren vollständigen Namen an.");
  });

  it("keeps the entered name, signature and consent after a transient 500", async () => {
    mount([{ data: view, error: null }, fail(500, { error: "boom" })]);
    fireEvent.change(await screen.findByLabelText("Ihr vollständiger Name"), { target: { value: "Anna Muster" } });
    fireEvent.click(screen.getByRole("button", { name: "signieren" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Angebot verbindlich annehmen" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ihre Antwort konnte nicht gespeichert werden");
    expect(screen.getByLabelText("Ihr vollständiger Name")).toHaveValue("Anna Muster");
    expect(screen.getByLabelText("Ihr vollständiger Name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "Angebot verbindlich annehmen" })).toBeEnabled();
  });

  it("rejects with the comment", async () => {
    mount([{ data: view, error: null }, { data: { ok: true }, error: null }]);
    fireEvent.click(await screen.findByRole("button", { name: "Stattdessen ablehnen" }));
    fireEvent.change(screen.getByLabelText("Ihr vollständiger Name"), { target: { value: "Anna Muster" } });
    fireEvent.change(screen.getByLabelText("Anmerkung (optional)"), { target: { value: "Zu teuer" } });
    fireEvent.click(screen.getByRole("button", { name: "Angebot ablehnen" }));
    expect(await screen.findByText("Vielen Dank für Ihre Antwort")).toBeInTheDocument();
    await waitFor(() => expect(decideCalls()[0].args[0]).toEqual({
      action: "decide", token: TOKEN, decision: "rejected", signer_name: "Anna Muster", comment: "Zu teuer",
    }));
  });

  it("passes Sie labels to the signature pad", async () => {
    mount([{ data: view, error: null }]);
    expect(await screen.findByText("Ihr vollständiger Name", { selector: "span" })).toBeInTheDocument();
  });

  it("moves focus to the heading of the thank-you card", async () => {
    mount([{ data: view, error: null }, { data: { ok: true }, error: null }]);
    fireEvent.click(await screen.findByRole("button", { name: "Stattdessen ablehnen" }));
    fireEvent.change(screen.getByLabelText("Ihr vollständiger Name"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "Angebot ablehnen" }));
    const heading = await screen.findByRole("heading", { name: "Vielen Dank für Ihre Antwort" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("moves focus to the heading of a closed card after a decide", async () => {
    mount([{ data: view, error: null }, fail(410, { error: "superseded" })]);
    fireEvent.change(await screen.findByLabelText("Ihr vollständiger Name"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "signieren" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Angebot verbindlich annehmen" }));
    const heading = await screen.findByRole("heading", { name: "Dieses Angebot wurde überarbeitet" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("shows the display number of a revised quote in the heading and the title", async () => {
    mount([{ data: { ...view, quote: { ...view.quote, version: 2, number: "A-0042-2" } }, error: null }]);
    expect(await screen.findByText("A-0042-2")).toBeInTheDocument();
    expect(document.title).toBe("Angebot A-0042-2");
  });

  it("falls back to quote_no and version when an older function sends no display number", async () => {
    const { number: _number, ...older } = { ...view.quote, version: 2 };
    mount([{ data: { ...view, quote: older }, error: null }]);
    expect(await screen.findByText("A-0042-2")).toBeInTheDocument();
    expect(document.title).toBe("Angebot A-0042-2");
  });

  it("sets the document title and a noindex meta while mounted", async () => {
    const { unmount } = mount([{ data: view, error: null }]);
    await screen.findByText("Badsanierung");
    expect(document.title).toBe("Angebot A-0042");
    expect(document.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull();
    unmount();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});
