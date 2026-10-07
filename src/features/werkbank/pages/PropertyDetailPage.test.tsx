import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

// Opt in to the v7 behaviour so the tests do not log the upgrade warnings.
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const { property, customer, remove, archive, sections } = vi.hoisted(() => ({
  property: { data: undefined as unknown, isLoading: false, isError: false },
  customer: { data: undefined as unknown },
  remove: { mutate: vi.fn(), isPending: false },
  archive: { mutate: vi.fn(), isPending: false },
  sections: { parents: [] as unknown[] },
}));
vi.mock("../hooks/useProperties", () => ({
  useProperty: () => property,
  useArchiveProperty: () => archive,
  useDeleteProperty: () => remove,
  useCreateProperty: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProperty: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useCustomers", () => ({ useCustomer: () => customer, useCustomers: () => ({ data: [] }) }));
vi.mock("../components/ContactsSection", () => ({
  ContactsSection: ({ parent }: { parent: unknown }) => {
    sections.parents.push(parent);
    return <div>contacts-section</div>;
  },
}));

import { PropertyDetailPage } from "./PropertyDetailPage";

const base = {
  id: "p1", org_id: "org-1", customer_id: "k1", name: "WEG Musterstr. 5", object_no: "O-100",
  street: "Musterstraße 5", postal_code: "04109", city: "Leipzig", country_code: "DE",
  billing_name: null, billing_street: null, billing_postal_code: null, billing_city: null, billing_country_code: null,
  access_notes: "Schlüssel beim Hausmeister", notes: null, archived_at: null,
  customer: { id: "k1", kind: "property_manager", company_name: "Hausverwaltung Müller", first_name: null, last_name: null, archived_at: null },
};

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
const renderPage = (hasRole: (r: string) => boolean = () => true) =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/properties/p1"]} future={ROUTER_FUTURE}>
      <Routes>
        <Route path="/properties/:id" element={<PropertyDetailPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
    { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never, hasRole: hasRole as never } },
  );

describe("PropertyDetailPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(property, { data: base, isLoading: false, isError: false });
    customer.data = { street: "Hauptstr. 1", postal_code: "01067", city: "Dresden" };
    sections.parents = [];
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("bills the customer, with their address, when no billing name is set", () => {
    renderPage();
    const box = within(screen.getByText("Rechnung geht an").closest("section") as HTMLElement);
    expect(box.getByText("Hausverwaltung Müller")).toBeInTheDocument();
    expect(box.getByText("Hauptstr. 1")).toBeInTheDocument();
    expect(box.getByText("01067 Dresden")).toBeInTheDocument();
    expect(box.queryByText(/vertreten durch/)).not.toBeInTheDocument();
  });

  it("bills the billing recipient, represented by the customer, when a billing name is set", () => {
    property.data = { ...base, billing_name: "WEG Musterstr. 5", billing_street: "Postfach 1", billing_postal_code: "04109", billing_city: "Leipzig", billing_country_code: "DE" };
    renderPage();
    const box = within(screen.getByText("Rechnung geht an").closest("section") as HTMLElement);
    expect(box.getByText("WEG Musterstr. 5, vertreten durch Hausverwaltung Müller")).toBeInTheDocument();
    expect(box.getByText("Postfach 1")).toBeInTheDocument();
    expect(box.getByText("04109 Leipzig")).toBeInTheDocument();
    expect(box.queryByText("Hauptstr. 1")).not.toBeInTheDocument();
  });

  it("shows the address, the access notes and the contacts of the property", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "WEG Musterstr. 5" })).toBeInTheDocument();
    expect(screen.getByText("Musterstraße 5")).toBeInTheDocument();
    expect(screen.getByText("Schlüssel beim Hausmeister")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hausverwaltung Müller" })).toHaveAttribute("href", "/customers/k1");
    expect(screen.getByText("contacts-section")).toBeInTheDocument();
    expect(sections.parents[0]).toEqual({ propertyId: "p1" });
  });

  it("shows a not-found state linking back to the list", () => {
    property.data = null;
    renderPage();
    expect(screen.getByText("Liegenschaft nicht gefunden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zu den Liegenschaften" })).toHaveAttribute("href", "/properties");
  });

  it("shows a skeleton while loading and an alert on error", () => {
    property.isLoading = true;
    const { container, unmount } = renderPage();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    unmount();
    Object.assign(property, { isLoading: false, isError: true });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Die Liegenschaft konnte nicht geladen werden");
  });

  it("archives, and offers delete only to an admin, going back to the list afterwards", () => {
    const { unmount } = renderPage((r) => r === "producer");
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    expect(archive.mutate).toHaveBeenCalledWith({ id: "p1", archived: true });
    unmount();
    remove.mutate.mockImplementation((_id, o) => o?.onSuccess?.());
    renderPage((r) => r === "admin");
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Löschen" }));
    expect(remove.mutate).toHaveBeenCalledWith("p1", expect.anything());
    expect(screen.getByTestId("where")).toHaveTextContent("/properties");
  });

  it("opens the edit dialog prefilled", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Name der Liegenschaft")).toHaveValue("WEG Musterstr. 5");
  });
});
