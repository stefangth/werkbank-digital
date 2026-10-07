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

import { NumberingTab } from "./NumberingTab";

function seed(result: { data: unknown; error: unknown }) {
  const fake = createFakeSupabase({ "werkbank.number_ranges": result });
  Object.assign(client, fake);
  return fake;
}

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

  it("shows the defaults and the preview when no row exists", async () => {
    seed({ data: null, error: null });
    renderTab();
    expect(await screen.findByText("Nächste Kundennummer: K-10001")).toBeInTheDocument();
    expect(screen.getByLabelText("Präfix")).toHaveValue("K-");
    expect(screen.getByLabelText("Nächste Nummer")).toHaveValue("10001");
  });

  it("updates the preview while typing", async () => {
    seed({ data: { prefix: "K-", next_value: 10001, padding: 4 }, error: null });
    renderTab();
    await screen.findByLabelText("Präfix");
    fireEvent.change(screen.getByLabelText("Präfix"), { target: { value: "KD" } });
    fireEvent.change(screen.getByLabelText("Nächste Nummer"), { target: { value: "5" } });
    expect(screen.getByText("Nächste Kundennummer: KD0005")).toBeInTheDocument();
  });

  it("saves next_value as a number and keeps the stored padding", async () => {
    const fake = seed({ data: { prefix: "K-", next_value: 10001, padding: 4 }, error: null });
    renderTab();
    await screen.findByLabelText("Präfix");
    fireEvent.change(screen.getByLabelText("Präfix"), { target: { value: "KD" } });
    fireEvent.change(screen.getByLabelText("Nächste Nummer"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
    expect(upserts(fake)[0].args).toEqual([
      { org_id: "org-1", key: "customer", prefix: "KD", next_value: 500, padding: 4 },
      { onConflict: "org_id,key" },
    ]);
  });

  it("rejects a next number of 0", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await screen.findByLabelText("Präfix");
    fireEvent.change(screen.getByLabelText("Nächste Nummer"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib eine ganze Zahl ab 1 ein")).toBeInTheDocument();
    expect(upserts(fake)).toHaveLength(0);
  });

  it("rejects a prefix longer than 10 characters", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await screen.findByLabelText("Präfix");
    fireEvent.change(screen.getByLabelText("Präfix"), { target: { value: "ABCDEFGHIJK" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Das Präfix darf höchstens 10 Zeichen lang sein")).toBeInTheDocument();
    expect(upserts(fake)).toHaveLength(0);
  });

  it("accepts a prefix of exactly 10 characters", async () => {
    const fake = seed({ data: null, error: null });
    renderTab();
    await screen.findByLabelText("Präfix");
    fireEvent.change(screen.getByLabelText("Präfix"), { target: { value: "ABCDEFGHIJ" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(upserts(fake)).toHaveLength(1));
  });

  it("shows an alert when loading fails", async () => {
    seed({ data: null, error: { code: "42501", message: "denied" } });
    renderTab();
    expect(await screen.findByText(/konnten nicht geladen werden/)).toBeInTheDocument();
  });
});
