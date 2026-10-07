import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

// Opt in to the v7 behaviour so the tests do not log the upgrade warnings.
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const { customer, properties, archive, sections, deleteCustomer } = vi.hoisted(() => ({
  customer: { data: undefined as unknown, isLoading: false, isError: false },
  properties: { data: [] as unknown[], isLoading: false, isError: false },
  archive: { mutate: vi.fn(), isPending: false },
  sections: { parents: [] as unknown[] },
  deleteCustomer: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../data/customers", async (orig) => ({ ...(await orig<typeof import("../data/customers")>()), deleteCustomer }));
// Only the reads and archive are faked; useDeleteCustomer stays real so the toast is the hook's own.
vi.mock("../hooks/useCustomers", async (orig) => ({
  ...(await orig<typeof import("../hooks/useCustomers")>()),
  useCustomer: () => customer,
  useArchiveCustomer: () => archive,
  useCustomers: () => ({ data: [customer.data] }),
}));
vi.mock("../hooks/useProperties", () => ({
  usePropertiesForCustomer: () => properties,
  useCreateProperty: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProperty: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../components/ContactsSection", () => ({
  ContactsSection: ({ parent }: { parent: unknown }) => {
    sections.parents.push(parent);
    return <div>contacts-section</div>;
  },
}));

import { toast } from "sonner";
import { CustomerDetailPage } from "./CustomerDetailPage";

const base = {
  id: "k1", org_id: "org-1", customer_no: "K-1001", kind: "property_manager", company_name: "Hausverwaltung Müller",
  first_name: null, last_name: null, street: "Hauptstr. 1", postal_code: "01067", city: "Dresden", country_code: "DE",
  email: "info@mueller.example", invoice_email: "rechnung@mueller.example", phone: "0351 123", vat_id: "DE123456789",
  payment_terms_days: 14, notes: "Zahlt pünktlich", archived_at: null,
};

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
const renderPage = (hasRole: (r: string) => boolean = () => true) =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/customers/k1"]} future={ROUTER_FUTURE}>
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
    { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: hasRole as never } },
  );

describe("CustomerDetailPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(customer, { data: base, isLoading: false, isError: false });
    Object.assign(properties, { data: [{ id: "p1", name: "WEG Musterstr. 5", object_no: "O-100", street: "Musterstraße 5", postal_code: "04109", city: "Leipzig", archived_at: null }], isLoading: false, isError: false });
    sections.parents = [];
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("shows name, number and kind in the header", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Hausverwaltung Müller" })).toBeInTheDocument();
    expect(screen.getByText("K-1001")).toBeInTheDocument();
    expect(screen.getByText("Hausverwaltung")).toBeInTheDocument();
  });

  it("shows the address and the payment terms in the master data", () => {
    renderPage();
    const box = within(screen.getByRole("region", { name: "Stammdaten" }));
    expect(box.getByText("Hauptstr. 1")).toBeInTheDocument();
    expect(box.getByText("01067 Dresden")).toBeInTheDocument();
    expect(box.getByText("14 Tage")).toBeInTheDocument();
    expect(box.getByText("DE123456789")).toBeInTheDocument();
    expect(box.getByText("rechnung@mueller.example")).toBeInTheDocument();
  });

  it("offers Löschen only to an admin", () => {
    const { unmount } = renderPage((r) => r === "producer");
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    unmount();
    renderPage((r) => r === "admin");
    expect(screen.getByRole("button", { name: "Löschen" })).toBeInTheDocument();
  });

  it("archives, and offers Wiederherstellen for an archived customer", () => {
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    expect(archive.mutate).toHaveBeenCalledWith({ id: "k1", archived: true });
    unmount();
    customer.data = { ...base, archived_at: "2026-01-01T00:00:00Z" };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));
    expect(archive.mutate).toHaveBeenCalledWith({ id: "k1", archived: false });
  });

  it("deletes and goes back to the list", async () => {
    deleteCustomer.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/customers"));
    expect(deleteCustomer).toHaveBeenCalledWith(expect.anything(), "k1");
  });

  it("toasts the in-use copy and stays when the customer still has properties", async () => {
    deleteCustomer.mockRejectedValue({ code: "23503", message: "violates foreign key constraint" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Das wird noch verwendet. Archiviere es stattdessen."));
    expect(screen.getByTestId("where")).toHaveTextContent("/customers/k1");
  });

  it("lists the properties as links and opens the property dialog with the customer preselected", async () => {
    renderPage();
    expect(screen.getByRole("link", { name: "WEG Musterstr. 5" })).toHaveAttribute("href", "/properties/p1");
    fireEvent.click(screen.getByRole("button", { name: "Liegenschaft anlegen" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Kunde" })).toHaveTextContent("Hausverwaltung Müller");
  });

  it("says so when the customer has no properties", () => {
    properties.data = [];
    renderPage();
    expect(screen.getByText("Dieser Kunde hat noch keine Liegenschaften.")).toBeInTheDocument();
  });

  it("renders the contacts section for the customer", () => {
    renderPage();
    expect(screen.getByText("contacts-section")).toBeInTheDocument();
    expect(sections.parents[0]).toEqual({ customerId: "k1" });
  });

  it("opens the edit dialog prefilled", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Firmenname")).toHaveValue("Hausverwaltung Müller");
  });

  it("shows a not-found state linking back to the list", () => {
    customer.data = null;
    renderPage();
    expect(screen.getByText("Kunde nicht gefunden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zu den Kunden" })).toHaveAttribute("href", "/customers");
  });

  it("shows a skeleton while loading and an alert on error", () => {
    customer.isLoading = true;
    const { container, unmount } = renderPage();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    unmount();
    Object.assign(customer, { isLoading: false, isError: true });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Der Kunde konnte nicht geladen werden");
  });
});
