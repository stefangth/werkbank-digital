import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { create, update, K1, K2 } = vi.hoisted(() => ({
  K1: "11111111-1111-4111-8111-111111111111",
  K2: "22222222-2222-4222-8222-222222222222",
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
}));
vi.mock("../hooks/useProperties", () => ({ useCreateProperty: () => create, useUpdateProperty: () => update }));
vi.mock("../hooks/useCustomers", () => ({
  useCustomers: () => ({
    data: [
      { id: K1, customer_no: "K-1", kind: "property_manager", company_name: "Muster HV", first_name: null, last_name: null, archived_at: null },
      { id: K2, customer_no: "K-2", kind: "property_manager", company_name: "Alte Verwaltung", first_name: null, last_name: null, archived_at: "2026-02-01T00:00:00Z" },
    ],
  }),
}));

import { PropertyFormDialog } from "./PropertyFormDialog";
import type { Property } from "../data/properties";
import { toPropertyRow } from "../schemas/property";

const property: Property = {
  id: "p1", org_id: "org-1", customer_id: K2, name: "WEG Musterstr. 5", object_no: "O-1",
  street: "Musterstraße 5", postal_code: "01067", city: "Dresden", country_code: "DE",
  billing_name: "WEG Musterstr. 5", billing_street: "Postfach 1", billing_postal_code: "01069", billing_city: "Dresden", billing_country_code: "DE",
  access_notes: null, notes: null, archived_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
} as Property;

const renderDialog = (props: { property?: Property; customerId?: string } = {}) =>
  renderWithProviders(<PropertyFormDialog open onOpenChange={vi.fn()} {...props} />, {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never },
  });

const fillBasics = () => {
  fireEvent.change(screen.getByLabelText("Name der Liegenschaft"), { target: { value: "Haus A" } });
  fireEvent.change(screen.getByLabelText("Straße und Hausnummer"), { target: { value: "Hauptstr. 1" } });
  fireEvent.change(screen.getByLabelText("PLZ"), { target: { value: "01067" } });
  fireEvent.change(screen.getByLabelText("Ort"), { target: { value: "Dresden" } });
};

describe("PropertyFormDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("preselects the given customer and saves with it", async () => {
    renderDialog({ customerId: K1 });
    expect(screen.getByRole("combobox", { name: "Kunde" })).toHaveTextContent("Muster HV");
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(create.mutate.mock.calls[0][0]).toMatchObject({ customer_id: K1, name: "Haus A", has_billing: false });
  });

  it("requires a customer", async () => {
    renderDialog();
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Wähle einen Kunden")).toBeInTheDocument();
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it("reveals the billing fields with the checkbox and validates them", async () => {
    renderDialog({ customerId: K1 });
    expect(screen.queryByLabelText("Name des Rechnungsempfängers")).not.toBeInTheDocument();
    fillBasics();
    fireEvent.click(screen.getByRole("checkbox", { name: "Abweichender Rechnungsempfänger" }));
    expect(screen.getByLabelText("Name des Rechnungsempfängers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib den Namen des Rechnungsempfängers ein")).toBeInTheDocument();
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it("saves null billing fields after unticking the checkbox on an edit", async () => {
    renderDialog({ property });
    expect(screen.getByLabelText("Name des Rechnungsempfängers")).toHaveValue("WEG Musterstr. 5");
    fireEvent.click(screen.getByRole("checkbox", { name: "Abweichender Rechnungsempfänger" }));
    expect(screen.queryByLabelText("Name des Rechnungsempfängers")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(update.mutate).toHaveBeenCalledTimes(1));
    const { id, form } = update.mutate.mock.calls[0][0];
    expect(id).toBe("p1");
    expect(form.has_billing).toBe(false);
    // The leftover billing text in the form never reaches the database row.
    expect(toPropertyRow(form)).toMatchObject({
      billing_name: null, billing_street: null, billing_postal_code: null, billing_city: null, billing_country_code: null,
    });
  });

  it("edits a property of an archived customer without forcing a change", async () => {
    renderDialog({ property });
    expect(screen.getByRole("combobox", { name: "Kunde" })).toHaveTextContent("Alte Verwaltung (archiviert)");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(update.mutate).toHaveBeenCalledTimes(1));
    expect(update.mutate.mock.calls[0][0].form.customer_id).toBe(K2);
  });

  it("closes on success and keeps the dialog open on failure", async () => {
    const onOpenChange = vi.fn();
    create.mutate.mockImplementation((_f, o) => o?.onSettled?.());
    renderWithProviders(<PropertyFormDialog open onOpenChange={onOpenChange} customerId={K1} />, {
      authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never },
    });
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
    create.mutate.mockImplementation((_f, o) => { o?.onSuccess?.(); o?.onSettled?.(); });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
