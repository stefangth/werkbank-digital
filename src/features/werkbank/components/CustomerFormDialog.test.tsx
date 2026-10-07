import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { create, update, toast } = vi.hoisted(() => ({
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../hooks/useCustomers", () => ({
  useCreateCustomer: () => create,
  useUpdateCustomer: () => update,
}));
vi.mock("sonner", () => ({ toast }));

import { CustomerFormDialog } from "./CustomerFormDialog";
import type { Customer } from "../data/customers";

const hv: Customer = {
  id: "k1",
  org_id: "org-1",
  customer_no: "K-10001",
  kind: "property_manager",
  company_name: "Muster Hausverwaltung GmbH",
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
};

function renderDialog(props: { customer?: Customer; open?: boolean; onOpenChange?: (o: boolean) => void } = {}) {
  const ui = (open: boolean) => (
    <CustomerFormDialog open={open} onOpenChange={props.onOpenChange ?? vi.fn()} customer={props.customer} />
  );
  const view = renderWithProviders(ui(props.open ?? true), {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never },
  });
  return { ...view, ui };
}

const fillAddress = () => {
  fireEvent.change(screen.getByLabelText("Straße und Hausnummer"), { target: { value: "Hauptstr. 1" } });
  fireEvent.change(screen.getByLabelText("PLZ"), { target: { value: "01067" } });
  fireEvent.change(screen.getByLabelText("Ort"), { target: { value: "Dresden" } });
};

describe("CustomerFormDialog", () => {
  // The provider re-reads the stored language (cleared after every test), so German has to be stored, not only set.
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("swaps the company name for first and last name when the kind is toggled", () => {
    renderDialog();
    expect(screen.getByLabelText("Firmenname")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nachname")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Privat" }));
    expect(screen.queryByLabelText("Firmenname")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Vorname (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Nachname")).toBeInTheDocument();
  });

  it("does not submit an invalid form", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib den Firmennamen ein")).toBeInTheDocument();
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it("creates a property manager with Germany and 14 days as defaults", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Firmenname"), { target: { value: "Neu GmbH" } });
    fillAddress();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(create.mutate.mock.calls[0][0]).toMatchObject({
      kind: "property_manager", company_name: "Neu GmbH", country_code: "DE", payment_terms_days: "14",
    });
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it("toasts the assigned customer number after a successful create and closes", async () => {
    const onOpenChange = vi.fn();
    create.mutate.mockImplementation((_form, opts) => opts?.onSuccess?.({ ...hv, customer_no: "K-10042" }));
    renderDialog({ onOpenChange });
    fireEvent.change(screen.getByLabelText("Firmenname"), { target: { value: "Neu GmbH" } });
    fillAddress();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Kunde angelegt, Kundennummer K-10042");
  });

  it("keeps the dialog open when the save fails", async () => {
    const onOpenChange = vi.fn();
    create.mutate.mockImplementation((_form, opts) => opts?.onSettled?.());
    renderDialog({ onOpenChange });
    fireEvent.change(screen.getByLabelText("Firmenname"), { target: { value: "Neu GmbH" } });
    fillAddress();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sends one write for two quick submits", async () => {
    create.mutate.mockImplementation(() => {}); // a save that has not settled yet
    renderDialog();
    fireEvent.change(screen.getByLabelText("Firmenname"), { target: { value: "Neu GmbH" } });
    fillAddress();
    const save = screen.getByRole("button", { name: "Speichern" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(create.mutate).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(create.mutate).toHaveBeenCalledTimes(1);
  });

  it("prefills an existing customer and updates it", async () => {
    renderDialog({ customer: hv });
    expect(screen.getByLabelText("Firmenname")).toHaveValue("Muster Hausverwaltung GmbH");
    expect(screen.getByLabelText("Kundennummer (optional)")).toHaveValue("K-10001");
    expect(screen.getByLabelText("Ort")).toHaveValue("Dresden");
    fireEvent.change(screen.getByLabelText("Ort"), { target: { value: "Leipzig" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(update.mutate).toHaveBeenCalledTimes(1));
    expect(update.mutate.mock.calls[0][0]).toMatchObject({ id: "k1", form: { city: "Leipzig", kind: "property_manager" } });
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it("switching an existing property manager to private requires a last name and sends no company name", async () => {
    renderDialog({ customer: hv });
    fireEvent.click(screen.getByRole("tab", { name: "Privat" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gib den Nachnamen ein")).toBeInTheDocument();
    expect(update.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nachname"), { target: { value: "Meier" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(update.mutate).toHaveBeenCalledTimes(1));
    const { form } = update.mutate.mock.calls[0][0];
    // The form still holds the old company name; the database row must not.
    expect(form.company_name).toBe("Muster Hausverwaltung GmbH");
    const { toCustomerRow } = await import("../schemas/customer");
    expect(toCustomerRow(form)).toMatchObject({ kind: "private", company_name: null, last_name: "Meier" });
  });

  it("resets the form when it is closed and reopened", () => {
    const { rerender, ui } = renderDialog();
    fireEvent.change(screen.getByLabelText("Firmenname"), { target: { value: "Halb fertig" } });
    rerender(ui(false));
    rerender(ui(true));
    expect(screen.getByLabelText("Firmenname")).toHaveValue("");
  });

  it("takes another country as a two-letter code", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("combobox", { name: "Land" }));
    fireEvent.click(await screen.findByRole("option", { name: "Anderes Land" }));
    const code = await screen.findByLabelText("Ländercode (zwei Buchstaben)");
    fireEvent.change(code, { target: { value: "nl" } });
    expect(code).toHaveValue("NL");
    fireEvent.change(screen.getByLabelText("Firmenname"), { target: { value: "Neu BV" } });
    fillAddress();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(create.mutate.mock.calls[0][0]).toMatchObject({ country_code: "NL" });
  });
});
