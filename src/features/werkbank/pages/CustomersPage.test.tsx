import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { client, navigate } = vi.hoisted(() => ({ client: {} as Record<string, unknown>, navigate: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import { CustomersPage } from "./CustomersPage";
import { customerPath } from "../paths";

const row = (over: Record<string, unknown>) => ({
  org_id: "org-1",
  kind: "property_manager",
  company_name: null,
  first_name: null,
  last_name: null,
  street: "Hauptstr. 1",
  postal_code: "01067",
  city: "Dresden",
  country_code: "DE",
  email: null,
  invoice_email: null,
  phone: null,
  vat_id: null,
  payment_terms_days: 14,
  notes: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  properties: [{ count: 0 }],
  ...over,
});

const customers = [
  row({ id: "k1", customer_no: "K-10001", company_name: "Muster Hausverwaltung GmbH", city: "Dresden", email: "info@muster-hv.de", phone: "0351 123", properties: [{ count: 3 }] }),
  row({ id: "k2", customer_no: "K-10002", kind: "private", last_name: "Meier", first_name: "Anna", city: "Leipzig" }),
  row({ id: "k3", customer_no: "K-10003", company_name: "Alte Verwaltung", city: "Chemnitz", archived_at: "2026-02-01T00:00:00Z" }),
];

function seed(data: unknown[] | null = customers, error: unknown = null) {
  Object.assign(client, createFakeSupabase({ "werkbank.customers": { data: error ? null : data, error } }));
}

function renderPage(hasRole: (r: string) => boolean = () => true) {
  return renderWithProviders(<CustomersPage />, {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: hasRole as never },
  });
}

describe("CustomersPage", () => {
  // The provider re-reads the stored language (cleared after every test), so German has to be stored, not only set.
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows the page mini above the list", async () => {
    seed();
    renderPage();
    expect(await screen.findByRole("region", { name: "So funktionieren Kunden" })).toBeInTheDocument();
  });

  it("renders the columns, the display names and the kind as a pill", async () => {
    seed();
    renderPage();
    const cell = await screen.findByText("Muster Hausverwaltung GmbH");
    for (const name of ["Nr.", "Name", "Art", "Ort", "Liegenschaften", "Telefon"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    const r = within(cell.closest("tr") as HTMLElement);
    expect(r.getByText("K-10001")).toBeInTheDocument();
    expect(r.getByText("Hausverwaltung")).toBeInTheDocument();
    expect(r.getByText("Dresden")).toBeInTheDocument();
    expect(r.getByText("3")).toBeInTheDocument();
    expect(r.getByText("0351 123")).toBeInTheDocument();
    expect(r.getByText("Hausverwaltung").className).toMatch(/accent/);
    const priv = within(screen.getByText("Meier, Anna").closest("tr") as HTMLElement);
    expect(priv.getByText("Privat")).toBeInTheDocument();
  });

  it("searches name, number, city and email after the debounce", async () => {
    seed();
    renderPage();
    await screen.findByText("Muster Hausverwaltung GmbH");
    vi.useFakeTimers();
    const search = screen.getByRole("searchbox", { name: "Kunden durchsuchen" });
    const type = (value: string) => {
      const before = screen.queryAllByRole("row").length;
      fireEvent.change(search, { target: { value } });
      // Not applied before the debounce has elapsed.
      expect(screen.queryAllByRole("row")).toHaveLength(before);
      act(() => { vi.advanceTimersByTime(275); });
    };
    type("leipzig");
    expect(screen.getByText("Meier, Anna")).toBeInTheDocument();
    expect(screen.queryByText("Muster Hausverwaltung GmbH")).not.toBeInTheDocument();
    type("k-10001");
    expect(screen.getByText("Muster Hausverwaltung GmbH")).toBeInTheDocument();
    expect(screen.queryByText("Meier, Anna")).not.toBeInTheDocument();
    type("muster-hv.de");
    expect(screen.getByText("Muster Hausverwaltung GmbH")).toBeInTheDocument();
    type("meier");
    expect(screen.getByText("Meier, Anna")).toBeInTheDocument();
    expect(screen.queryByText("Muster Hausverwaltung GmbH")).not.toBeInTheDocument();
    type("gibtesnicht");
    expect(screen.getByText("Kein Kunde passt zu deiner Suche.")).toBeInTheDocument();
  });

  it("filters by kind", async () => {
    seed();
    renderPage();
    await screen.findByText("Muster Hausverwaltung GmbH");
    fireEvent.click(screen.getByRole("combobox", { name: "Art" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Alle Arten", "Hausverwaltung", "Privat"]);
    fireEvent.click(screen.getByRole("option", { name: "Privat" }));
    await waitFor(() => expect(screen.queryByText("Muster Hausverwaltung GmbH")).not.toBeInTheDocument());
    expect(screen.getByText("Meier, Anna")).toBeInTheDocument();
  });

  it("hides archived customers until the switch is on", async () => {
    seed();
    renderPage();
    await screen.findByText("Muster Hausverwaltung GmbH");
    expect(screen.queryByText("Alte Verwaltung")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Archivierte anzeigen" }));
    expect(screen.getByText("Alte Verwaltung")).toBeInTheDocument();
    expect(screen.getByText("Archiviert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederherstellen" })).toBeInTheDocument();
  });

  it("shows the empty state with the create action, and the import action next to it", async () => {
    seed([]);
    renderPage((r) => r === "producer");
    expect(await screen.findByText("Noch keine Kunden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importieren" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ersten Kunden anlegen" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Kunde anlegen", { selector: "h2" })).toBeInTheDocument();
  });

  it("navigates to the customer on a row click, but not from the row buttons", async () => {
    seed();
    renderPage();
    const cell = await screen.findByText("Muster Hausverwaltung GmbH");
    const tr = cell.closest("tr") as HTMLElement;
    fireEvent.click(within(tr).getByRole("button", { name: "Bearbeiten" }));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(cell);
    expect(navigate).toHaveBeenCalledWith(customerPath("k1"));
  });

  it("offers delete only to an admin and confirms with the name", async () => {
    seed();
    const { unmount } = renderPage((r) => r === "producer");
    await screen.findByText("Meier, Anna");
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    unmount();
    seed();
    renderPage((r) => r === "admin");
    const cell = await screen.findByText("Meier, Anna");
    fireEvent.click(within(cell.closest("tr") as HTMLElement).getByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Meier, Anna/)).toBeInTheDocument();
  });

  it("opens the edit dialog prefilled", async () => {
    seed();
    renderPage();
    const cell = await screen.findByText("Muster Hausverwaltung GmbH");
    fireEvent.click(within(cell.closest("tr") as HTMLElement).getByRole("button", { name: "Bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Firmenname")).toHaveValue("Muster Hausverwaltung GmbH");
  });

  it("opens the import dialog from the header action", async () => {
    seed();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Importieren" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Kunden importieren")).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    seed();
    const { container } = renderPage();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows an alert when loading fails", async () => {
    seed(null, { message: "boom", code: "XX000" });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Deine Kunden konnten nicht geladen werden");
  });
});
