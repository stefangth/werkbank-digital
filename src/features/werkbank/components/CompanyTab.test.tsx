import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import { createFakeSupabase } from "@/test/supabaseFake";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CompanyTab } from "./CompanyTab";

function seed(result: { data: unknown; error: unknown }) {
  const fake = createFakeSupabase({ "werkbank.company_profiles": result });
  Object.assign(client, fake, { storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) } });
  return fake;
}

function renderTab() {
  return renderWithProviders(<CompanyTab />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } });
}

const upserts = (fake: ReturnType<typeof createFakeSupabase>) => fake.calls.filter((c) => c.method === "upsert");
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("CompanyTab", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("renders the empty form with the defaults", async () => {
    seed({ data: null, error: null });
    renderTab();
    expect(await screen.findByLabelText("Firmenname")).toHaveValue("");
    expect(screen.getByLabelText("Angebot gültig für (Tage)")).toHaveValue("30");
  });

  it("explains the preset payment term and validity", async () => {
    seed({ data: null, error: null });
    renderTab();
    await screen.findByLabelText("Firmenname");
    expect(screen.getByRole("button", { name: /^Vorgabe 14 Tage\. Gilt für jede neue Rechnung/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Vorgabe 30 Tage\. Gilt für jedes neue Angebot/ })).toBeInTheDocument();
  });

  it("shows the stored profile", async () => {
    seed({ data: { org_id: "org-1", company_name: "Muster Bau GmbH", street: "Hauptstr. 1", postal_code: "01067", city: "Dresden", country_code: "DE", quote_validity_days: 14, iban: null, updated_at: "2026-10-08T10:00:00Z" }, error: null });
    renderTab();
    expect(await screen.findByLabelText("Firmenname")).toHaveValue("Muster Bau GmbH");
    expect(screen.getByLabelText("Angebot gültig für (Tage)")).toHaveValue("14");
  });

  it("saves an upsert with a normalised IBAN and the validity as a number", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await screen.findByLabelText("Firmenname");
    type("Firmenname", "Muster Bau GmbH");
    type("Straße und Hausnummer", "Hauptstr. 1");
    type("PLZ", "01067");
    type("Ort", "Dresden");
    type("IBAN (optional)", "de89 3704 0044 0532 0130 00");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
    const [payload, opts] = upserts(fake)[0].args as [Record<string, unknown>, unknown];
    expect(opts).toEqual({ onConflict: "org_id" });
    expect(payload).toMatchObject({ org_id: "org-1", company_name: "Muster Bau GmbH", iban: "DE89370400440532013000", quote_validity_days: 30, phone: null });
  });

  it("does not save a validity of 0", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await screen.findByLabelText("Firmenname");
    type("Firmenname", "Muster Bau GmbH");
    type("Straße und Hausnummer", "Hauptstr. 1");
    type("PLZ", "01067");
    type("Ort", "Dresden");
    type("Angebot gültig für (Tage)", "0");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib ganze Tage von 1 bis 365 ein")).toBeInTheDocument();
    expect(upserts(fake)).toHaveLength(0);
  });

  it("disables Save while a logo upload is pending", async () => {
    const fake = createFakeSupabase({ "werkbank.company_profiles": { data: null, error: null } });
    let finish: (v: { error: null }) => void = () => {};
    const upload = vi.fn(() => new Promise<{ error: null }>((resolve) => { finish = resolve; }));
    Object.assign(client, fake, { storage: { from: () => ({ upload, createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed/logo" }, error: null }) }) } });
    renderTab();
    await screen.findByLabelText("Firmenname");
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Logo"), { target: { files: [new File(["x"], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText("Das Logo wird hochgeladen")).toBeInTheDocument();
    await act(async () => { finish({ error: null }); });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.queryByText("Das Logo wird hochgeladen")).not.toBeInTheDocument();
  });

  it("shows an alert when loading fails", async () => {
    seed({ data: null, error: { code: "42501", message: "denied" } });
    renderTab();
    expect(await screen.findByText(/konnten nicht geladen werden/)).toBeInTheDocument();
  });

  it("shows and saves the invoice defaults", async () => {
    const fake = seed({ data: { org_id: "org-1", company_name: "Muster Bau GmbH", street: "Hauptstr. 1", postal_code: "01067", city: "Dresden", country_code: "DE", quote_validity_days: 14, payment_due_days: 21, reminder_after_days: 7, dunning1_after_days: 14, dunning2_after_days: 14, dunning_deadline_days: 7, invoice_intro: "Hallo", invoice_closing: null, updated_at: "2026-10-08T10:00:00Z" }, error: null });
    renderTab();
    expect(await screen.findByLabelText("Zahlungsziel (Tage)")).toHaveValue("21");
    expect(screen.getByLabelText("Einleitungstext für Rechnungen (optional)")).toHaveValue("Hallo");
    type("Zahlungsziel (Tage)", "0");
    type("Einleitungstext für Rechnungen (optional)", "Guten Tag");
    type("Schlusstext für Rechnungen (optional)", "Danke");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
    expect((upserts(fake)[0].args as [Record<string, unknown>])[0]).toMatchObject({ payment_due_days: 0, invoice_intro: "Guten Tag", invoice_closing: "Danke" });
  });

  it("defaults the payment term to 14 days and rejects more than 365", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    expect(await screen.findByLabelText("Zahlungsziel (Tage)")).toHaveValue("14");
    type("Firmenname", "Muster Bau GmbH");
    type("Straße und Hausnummer", "Hauptstr. 1");
    type("PLZ", "01067");
    type("Ort", "Dresden");
    type("Zahlungsziel (Tage)", "366");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib ganze Tage von 0 bis 365 ein")).toBeInTheDocument();
    expect(upserts(fake)).toHaveLength(0);
  });

  describe("Mahnwesen", () => {
    const fillRequired = () => {
      type("Firmenname", "Muster Bau GmbH");
      type("Straße und Hausnummer", "Hauptstr. 1");
      type("PLZ", "01067");
      type("Ort", "Dresden");
    };

    it("shows the defaults and the default texts as placeholders", async () => {
      seed({ data: null, error: null });
      renderTab();
      expect(await screen.findByLabelText("Zahlungserinnerung nach (Tage)")).toHaveValue("7");
      expect(screen.getByLabelText("1. Mahnung nach (Tage)")).toHaveValue("14");
      expect(screen.getByLabelText("2. und letzte Mahnung nach (Tage)")).toHaveValue("14");
      expect(screen.getByLabelText("Zahlungsfrist in Mahnungen (Tage)")).toHaveValue("7");
      expect(screen.getByLabelText("Text für Zahlungserinnerung (optional)")).toHaveAttribute("placeholder", expect.stringContaining("sicher ist Ihnen im Alltag entgangen"));
      expect(screen.getAllByRole("button", { name: "Leer lassen für den Standardtext." })).toHaveLength(3);
      expect(screen.getByRole("button", { name: "Vorgabe 7 Tage nach Fälligkeit der Rechnung. Du kannst den Wert hier ändern." })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Vorgabe 7 Tage. So lange hat der Kunde nach einer Mahnung Zeit zu zahlen. Du kannst den Wert hier ändern." })).toBeInTheDocument();
    });

    it("saves the four day fields as numbers and a blank text as null", async () => {
      const fake = seed({ data: null, error: null });
      renderTab();
      await screen.findByLabelText("Firmenname");
      fillRequired();
      type("Zahlungserinnerung nach (Tage)", "3");
      type("1. Mahnung nach (Tage)", "10");
      type("2. und letzte Mahnung nach (Tage)", "0");
      type("Zahlungsfrist in Mahnungen (Tage)", "365");
      type("Text für 1. Mahnung (optional)", "  Eigener Text  ");
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(upserts(fake)).toHaveLength(1));
      const [payload] = upserts(fake)[0].args as [Record<string, unknown>];
      expect(payload).toMatchObject({
        reminder_after_days: 3, dunning1_after_days: 10, dunning2_after_days: 0, dunning_deadline_days: 365,
        reminder_text: null, dunning1_text: "Eigener Text", dunning2_text: null,
      });
    });

    it("rejects 366 days", async () => {
      const fake = seed({ data: null, error: null });
      renderTab();
      await screen.findByLabelText("Firmenname");
      fillRequired();
      type("Zahlungsfrist in Mahnungen (Tage)", "366");
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      expect(await screen.findByText("Gib ganze Tage von 0 bis 365 ein")).toBeInTheDocument();
      expect(upserts(fake)).toHaveLength(0);
    });

    it("shows the stored values", async () => {
      seed({ data: { org_id: "org-1", company_name: "X", street: "s", postal_code: "01067", city: "c", country_code: "DE", quote_validity_days: 30, payment_due_days: 14,
        reminder_after_days: 5, dunning1_after_days: 6, dunning2_after_days: 8, dunning_deadline_days: 9, reminder_text: "Mein Text", dunning1_text: null, dunning2_text: null, updated_at: "2026-10-08T10:00:00Z" }, error: null });
      renderTab();
      expect(await screen.findByLabelText("Zahlungserinnerung nach (Tage)")).toHaveValue("5");
      expect(screen.getByLabelText("Zahlungsfrist in Mahnungen (Tage)")).toHaveValue("9");
      expect(screen.getByLabelText("Text für Zahlungserinnerung (optional)")).toHaveValue("Mein Text");
    });
  });
});
