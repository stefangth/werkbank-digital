import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import { createFakeSupabase } from "@/test/supabaseFake";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { NumberingTab } from "./NumberingTab";

function seed(result: { data: unknown; error: unknown }, issuedInvoices = 0) {
  // The same result for every key; per-key seeds go through seedByKey.
  const fake = createFakeSupabase({
    "werkbank.number_ranges": result,
    "werkbank.invoices": { data: null, error: null, count: issuedInvoices },
  });
  Object.assign(client, fake);
  return fake;
}

function seedByKey(byKey: Record<string, unknown>) {
  const fake = createFakeSupabase({
    "werkbank.number_ranges": Object.entries(byKey).map(([key, data]) => ({ when: { key }, data, error: null })),
  });
  Object.assign(client, fake);
  return fake;
}

/** One row of the tab: the form fields repeat per key, so queries are scoped to the row. */
const row = (name: string) => within(screen.getByRole("group", { name }));

function renderTab() {
  return renderWithProviders(<NumberingTab />, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } });
}

const upserts = (fake: ReturnType<typeof createFakeSupabase>) => fake.calls.filter((c) => c.method === "upsert");

describe("NumberingTab", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows four rows with the default previews when no row exists", async () => {
    seed({ data: null, error: null });
    renderTab();
    expect(await screen.findByText("Nächste Kundennummer: K-10001")).toBeInTheDocument();
    expect(await screen.findByText("Nächste Angebotsnummer: A-0001")).toBeInTheDocument();
    expect(await screen.findByText("Nächste Auftragsnummer: AU-0001")).toBeInTheDocument();
    expect(await screen.findByText("Nächste Rechnungsnummer: RE-0001")).toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(4);
    expect(row("Rechnungsnummern").getByLabelText("Präfix")).toHaveValue("RE-");
    expect(row("Angebotsnummern").getByLabelText("Präfix")).toHaveValue("A-");
    expect(row("Auftragsnummern").getByLabelText("Präfix")).toHaveValue("AU-");
    expect(row("Kundennummern").getByLabelText("Präfix")).toHaveValue("K-");
    expect(row("Kundennummern").getByLabelText("Nächste Nummer")).toHaveValue("10001");
  });

  it("shows the stored range of each key", async () => {
    seedByKey({
      customer: { prefix: "K-", next_value: 10001, padding: 0 },
      quote: { prefix: "A-", next_value: 42, padding: 4 },
      order: { prefix: "AU-", next_value: 7, padding: 4 },
      invoice: { prefix: "RE-", next_value: 3, padding: 4 },
    });
    renderTab();
    expect(await screen.findByText("Nächste Angebotsnummer: A-0042")).toBeInTheDocument();
    expect(screen.getByText("Nächste Auftragsnummer: AU-0007")).toBeInTheDocument();
    expect(screen.getByText("Nächste Rechnungsnummer: RE-0003")).toBeInTheDocument();
  });

  it("saves the quote row under the key quote and leaves the others alone", async () => {
    const fake = seed({ data: { prefix: "A-", next_value: 1, padding: 4 }, error: null });
    renderTab();
    await row("Angebotsnummern").findByLabelText("Präfix");
    fireEvent.change(row("Angebotsnummern").getByLabelText("Präfix"), { target: { value: "AN-" } });
    fireEvent.change(row("Angebotsnummern").getByLabelText("Nächste Nummer"), { target: { value: "100" } });
    fireEvent.click(row("Angebotsnummern").getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
    expect(upserts(fake)[0].args).toEqual([
      { org_id: "org-1", key: "quote", prefix: "AN-", next_value: 100, padding: 4 },
      { onConflict: "org_id,key" },
    ]);
  });

  it("updates the preview while typing", async () => {
    seed({ data: { prefix: "K-", next_value: 10001, padding: 4 }, error: null });
    renderTab();
    await row("Kundennummern").findByLabelText("Präfix");
    fireEvent.change(row("Kundennummern").getByLabelText("Präfix"), { target: { value: "KD" } });
    fireEvent.change(row("Kundennummern").getByLabelText("Nächste Nummer"), { target: { value: "5" } });
    expect(screen.getByText("Nächste Kundennummer: KD0005")).toBeInTheDocument();
  });

  it("saves next_value as a number and keeps the stored padding", async () => {
    const fake = seed({ data: { prefix: "K-", next_value: 10001, padding: 4 }, error: null });
    renderTab();
    await row("Kundennummern").findByLabelText("Präfix");
    fireEvent.change(row("Kundennummern").getByLabelText("Präfix"), { target: { value: "KD" } });
    fireEvent.change(row("Kundennummern").getByLabelText("Nächste Nummer"), { target: { value: "500" } });
    fireEvent.click(row("Kundennummern").getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
    expect(upserts(fake)[0].args).toEqual([
      { org_id: "org-1", key: "customer", prefix: "KD", next_value: 500, padding: 4 },
      { onConflict: "org_id,key" },
    ]);
  });

  it("saves a prefix change without the loaded next number, so the counter does not move back", async () => {
    const fake = seed({ data: { prefix: "K-", next_value: 10050, padding: 0 }, error: null });
    renderTab();
    await row("Kundennummern").findByLabelText("Präfix");
    fireEvent.change(row("Kundennummern").getByLabelText("Präfix"), { target: { value: "KD-" } });
    fireEvent.click(row("Kundennummern").getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === "update")).toBe(true));
    const writes = fake.calls.filter((c) => c.method === "upsert" || c.method === "update");
    expect(writes.some((c) => JSON.stringify(c.args).includes("10050"))).toBe(false);
    expect(fake.calls.find((c) => c.method === "update")?.args).toEqual([{ prefix: "KD-", padding: 0 }]);
  });

  it("shows the refetched range after the data changes", async () => {
    const range = { prefix: "K-", next_value: 10001, padding: 0 };
    seed({ data: range, error: null });
    const { queryClient } = renderTab();
    expect(await row("Kundennummern").findByLabelText("Nächste Nummer")).toHaveValue("10001");
    range.next_value = 10007;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ["werkbank", "number-ranges"] }); });
    await waitFor(() => expect(row("Kundennummern").getByLabelText("Nächste Nummer")).toHaveValue("10007"));
    expect(screen.getByText("Nächste Kundennummer: K-10007")).toBeInTheDocument();
  });

  it("rejects a next number of 0", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await row("Kundennummern").findByLabelText("Präfix");
    fireEvent.change(row("Kundennummern").getByLabelText("Nächste Nummer"), { target: { value: "0" } });
    fireEvent.click(row("Kundennummern").getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib eine ganze Zahl ab 1 ein")).toBeInTheDocument();
    expect(upserts(fake)).toHaveLength(0);
  });

  it("rejects a prefix longer than 10 characters", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await row("Kundennummern").findByLabelText("Präfix");
    fireEvent.change(row("Kundennummern").getByLabelText("Präfix"), { target: { value: "ABCDEFGHIJK" } });
    fireEvent.click(row("Kundennummern").getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Das Präfix darf höchstens 10 Zeichen lang sein")).toBeInTheDocument();
    expect(upserts(fake)).toHaveLength(0);
  });

  it("accepts a prefix of exactly 10 characters", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await row("Kundennummern").findByLabelText("Präfix");
    fireEvent.change(row("Kundennummern").getByLabelText("Präfix"), { target: { value: "ABCDEFGHIJ" } });
    fireEvent.click(row("Kundennummern").getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
  });

  it("shows an alert when loading fails", async () => {
    seed({ data: null, error: { code: "42501", message: "denied" } });
    renderTab();
    expect(await screen.findByText(/konnten nicht geladen werden/)).toBeInTheDocument();
  });

  it("enables the invoice inputs while no invoice is issued", async () => {
    seed({ data: { prefix: "RE-", next_value: 1, padding: 4 }, error: null }, 0);
    renderTab();
    expect(await row("Rechnungsnummern").findByLabelText("Präfix")).toBeEnabled();
    expect(row("Rechnungsnummern").getByLabelText("Nächste Nummer")).toBeEnabled();
  });

  it("locks prefix and start of the invoice range once an invoice is issued, but not the others", async () => {
    const fake = seed({ data: { prefix: "RE-", next_value: 5, padding: 4 }, error: null }, 2);
    renderTab();
    await waitFor(() => expect(row("Rechnungsnummern").getByLabelText("Präfix")).toBeDisabled());
    expect(row("Rechnungsnummern").getByLabelText("Nächste Nummer")).toBeDisabled();
    expect(row("Rechnungsnummern").getByText(/nicht mehr geändert/)).toBeInTheDocument();
    expect(row("Rechnungsnummern").queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
    expect(row("Angebotsnummern").getByLabelText("Präfix")).toBeEnabled();
    const counts = fake.calls.filter((c) => c.table === "werkbank.invoices");
    expect(counts).toContainEqual(expect.objectContaining({ method: "eq", args: ["org_id", "org-1"] }));
    expect(counts).toContainEqual(expect.objectContaining({ method: "neq", args: ["status", "draft"] }));
  });

  it("shows the locked copy when the server rejects a change", async () => {
    let fail = false;
    const fake = createFakeSupabase({
      "werkbank.number_ranges": { data: { prefix: "RE-", next_value: 1, padding: 4 }, get error() { return fail ? { code: "55000", message: "number_range_locked" } : null; } },
      "werkbank.invoices": { data: null, error: null, count: 0 },
    });
    Object.assign(client, fake);
    renderTab();
    await row("Rechnungsnummern").findByLabelText("Präfix");
    fail = true;
    fireEvent.change(row("Rechnungsnummern").getByLabelText("Präfix"), { target: { value: "R-" } });
    fireEvent.click(row("Rechnungsnummern").getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Dieser Nummernkreis kann nicht mehr geändert werden."));
  });

  it("blocks lowering the invoice start but saves a raised one", async () => {
    const fake = seed({ data: { prefix: "RE-", next_value: 100, padding: 4 }, error: null });
    renderTab();
    const next = await row("Rechnungsnummern").findByLabelText("Nächste Nummer");
    fireEvent.change(next, { target: { value: "50" } });
    fireEvent.click(row("Rechnungsnummern").getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Der Startwert kann nur erhöht werden.")).toBeInTheDocument();
    expect(upserts(fake)).toHaveLength(0);
    fireEvent.change(next, { target: { value: "120" } });
    fireEvent.click(row("Rechnungsnummern").getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
    expect(upserts(fake)[0].args[0]).toMatchObject({ key: "invoice", next_value: 120 });
  });
});
