import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

// Opt in to the v7 behaviour so the tests do not log the upgrade warnings.
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PropertiesPage } from "./PropertiesPage";
import { propertyPath } from "../paths";

const customer = (over: Record<string, unknown>) => ({
  id: "k1", kind: "property_manager", company_name: "Muster Hausverwaltung", first_name: null, last_name: null, archived_at: null, ...over,
});
const row = (over: Record<string, unknown>) => ({
  org_id: "org-1", customer_id: "k1", object_no: null, street: "Hauptstr. 1", postal_code: "01067", city: "Dresden",
  country_code: "DE", billing_name: null, billing_street: null, billing_postal_code: null, billing_city: null,
  billing_country_code: null, access_notes: null, notes: null, archived_at: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", customer: customer({}), ...over,
});

const properties = [
  row({ id: "p1", name: "WEG Musterstr. 5", object_no: "O-100", street: "Musterstraße 5", postal_code: "04109", city: "Leipzig" }),
  row({ id: "p2", name: "Haus Meier", customer_id: "k2", customer: customer({ id: "k2", kind: "private", company_name: null, last_name: "Meier", first_name: "Anna" }) }),
  row({ id: "p3", name: "Altbau", archived_at: "2026-02-01T00:00:00Z" }),
];

const seed = (data: unknown[] | null = properties, error: unknown = null) =>
  Object.assign(client, createFakeSupabase({ "werkbank.properties": { data: error ? null : data, error } }));

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
function renderPage(hasRole: (r: string) => boolean = () => true) {
  return renderWithProviders(
    <MemoryRouter future={ROUTER_FUTURE}>
      <PropertiesPage />
      <Where />
    </MemoryRouter>,
    { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: hasRole as never } },
  );
}

describe("PropertiesPage", () => {
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

  it("renders the columns with address and customer name", async () => {
    seed();
    renderPage();
    const cell = await screen.findByText("WEG Musterstr. 5");
    for (const name of ["Name", "Objekt-Nr.", "Adresse", "Kunde"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    const r = within(cell.closest("tr") as HTMLElement);
    expect(r.getByText("O-100")).toBeInTheDocument();
    expect(r.getByText("Musterstraße 5, 04109 Leipzig")).toBeInTheDocument();
    expect(r.getByText("Muster Hausverwaltung")).toBeInTheDocument();
    expect(within(screen.getByText("Haus Meier").closest("tr") as HTMLElement).getByText("Meier, Anna")).toBeInTheDocument();
  });

  it("searches name, object number, street, postal code, city and customer name", async () => {
    seed();
    renderPage();
    await screen.findByText("WEG Musterstr. 5");
    vi.useFakeTimers();
    const search = screen.getByRole("searchbox", { name: "Liegenschaften durchsuchen" });
    const type = (value: string) => {
      fireEvent.change(search, { target: { value } });
      act(() => { vi.advanceTimersByTime(275); });
    };
    for (const needle of ["Musterstr", "o-100", "04109", "leipzig", "weg"]) {
      type(needle);
      expect(screen.getByText("WEG Musterstr. 5")).toBeInTheDocument();
      expect(screen.queryByText("Haus Meier")).not.toBeInTheDocument();
    }
    type("meier");
    expect(screen.getByText("Haus Meier")).toBeInTheDocument();
    expect(screen.queryByText("WEG Musterstr. 5")).not.toBeInTheDocument();
    type("gibtesnicht");
    expect(screen.getByText("Keine Liegenschaft passt zu deiner Suche.")).toBeInTheDocument();
  });

  it("hides archived properties until the switch is on", async () => {
    seed();
    renderPage();
    await screen.findByText("WEG Musterstr. 5");
    expect(screen.queryByText("Altbau")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Archivierte anzeigen" }));
    expect(screen.getByText("Altbau")).toBeInTheDocument();
    expect(screen.getByText("Archiviert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederherstellen" })).toBeInTheDocument();
  });

  it("makes the name a link, and opens the property from a row click but not from the row buttons", async () => {
    seed();
    renderPage();
    const link = await screen.findByRole("link", { name: "WEG Musterstr. 5" });
    expect(link).toHaveAttribute("href", propertyPath("p1"));
    const tr = link.closest("tr") as HTMLElement;
    fireEvent.click(within(tr).getByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/");
    expect(screen.getByTestId("where").textContent).not.toBe(propertyPath("p1"));
    fireEvent.click(within(tr).getByText("O-100"));
    expect(screen.getByTestId("where")).toHaveTextContent(propertyPath("p1"));
  });

  it("offers delete only to an admin and confirms with the name", async () => {
    seed();
    const { unmount } = renderPage((r) => r === "producer");
    await screen.findByText("Haus Meier");
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    unmount();
    seed();
    renderPage((r) => r === "admin");
    const cell = await screen.findByText("Haus Meier");
    fireEvent.click(within(cell.closest("tr") as HTMLElement).getByRole("button", { name: "Löschen" }));
    expect(within(await screen.findByRole("alertdialog")).getByText(/Haus Meier/)).toBeInTheDocument();
  });

  it("opens the create dialog from the empty state", async () => {
    seed([]);
    renderPage();
    expect(await screen.findByText("Noch keine Liegenschaften")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erste Liegenschaft anlegen" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows a skeleton while loading and an alert when loading fails", async () => {
    seed();
    const { container, unmount } = renderPage();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    await screen.findByText("WEG Musterstr. 5");
    unmount();
    seed(null, { message: "boom", code: "XX000" });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Deine Liegenschaften konnten nicht geladen werden"));
  });
});
