import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { state, create, update, remove } = vi.hoisted(() => ({
  state: { data: [] as unknown[], isLoading: false, isError: false },
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
}));
vi.mock("../hooks/useContacts", () => ({
  useContacts: () => state,
  useCreateContact: () => create,
  useUpdateContact: () => update,
  useDeleteContact: () => remove,
}));

import { ContactsSection } from "./ContactsSection";

const contact = (over: Record<string, unknown>) => ({
  org_id: "org-1", customer_id: null, property_id: "p1", first_name: null, role: null, phone: null,
  mobile: null, email: null, notes: null, is_primary: false, ...over,
});

const parent = { propertyId: "p1" };
const renderSection = () =>
  renderWithProviders(<ContactsSection parent={parent} />, {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never },
  });

describe("ContactsSection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(state, { isLoading: false, isError: false });
    state.data = [
      contact({ id: "c1", last_name: "Berg", first_name: "Anna", role: "Hausmeisterin", phone: "0351 1", is_primary: true }),
      contact({ id: "c2", last_name: "Adler", email: "adler@example.de" }),
    ];
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("lists the contacts in the order given, marking the primary one", () => {
    renderSection();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Anna Berg")).toBeInTheDocument();
    expect(within(items[0]).getByText("Hauptansprechpartner")).toBeInTheDocument();
    expect(within(items[0]).getByText("Hausmeisterin")).toBeInTheDocument();
    expect(within(items[1]).getByText("Adler")).toBeInTheDocument();
    expect(within(items[1]).queryByText("Hauptansprechpartner")).not.toBeInTheDocument();
  });

  it("creates a contact under the parent", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Ansprechpartner anlegen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nachname"), { target: { value: "Neu" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Hauptansprechpartner" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(create.mutate.mock.calls[0][0]).toMatchObject({ parent, form: { last_name: "Neu", is_primary: true } });
  });

  it("requires a last name and a valid email", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Ansprechpartner anlegen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("E-Mail (optional)"), { target: { value: "kaputt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Gib den Nachnamen ein")).toBeInTheDocument();
    expect(within(dialog).getByText("Gib eine gültige E-Mail-Adresse ein")).toBeInTheDocument();
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it("edits a contact prefilled", async () => {
    renderSection();
    fireEvent.click(within(screen.getAllByRole("listitem")[0]).getByRole("button", { name: "Bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nachname")).toHaveValue("Berg");
    expect(within(dialog).getByRole("checkbox", { name: "Hauptansprechpartner" })).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText("Nachname"), { target: { value: "Berger" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(update.mutate).toHaveBeenCalledTimes(1));
    expect(update.mutate.mock.calls[0][0]).toMatchObject({ parent, id: "c1", form: { last_name: "Berger", is_primary: true } });
  });

  it("asks before deleting and deletes only after the confirmation", async () => {
    renderSection();
    fireEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "Löschen" }));
    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText(/Adler/)).toBeInTheDocument();
    expect(remove.mutate).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole("button", { name: "Löschen" }));
    expect(remove.mutate).toHaveBeenCalledWith("c2", expect.anything());
  });

  it("shows an empty state with the create action", () => {
    state.data = [];
    renderSection();
    expect(screen.getByText("Noch keine Ansprechpartner")).toBeInTheDocument();
  });

  it("shows an alert when loading fails", () => {
    state.isError = true;
    renderSection();
    expect(screen.getByRole("alert")).toHaveTextContent("Die Ansprechpartner konnten nicht geladen werden");
  });
});
