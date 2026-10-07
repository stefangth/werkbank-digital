import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { contacts } = vi.hoisted(() => ({ contacts: { customer: [] as unknown[], property: [] as unknown[] } }));
vi.mock("../hooks/useContacts", () => ({
  useContacts: (parent?: { customerId?: string; propertyId?: string }) => ({
    data: !parent ? undefined : parent.propertyId ? contacts.property : contacts.customer,
  }),
}));

import { ContactSelect } from "./ContactSelect";

const c = (id: string, last: string, role: string | null = null) => ({ id, first_name: "Max", last_name: last, role });

describe("ContactSelect", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
    contacts.customer = [c("c1", "Kunde")];
    contacts.property = [c("c2", "Objekt")];
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("lists the property contacts before the customer contacts", async () => {
    renderWithProviders(<ContactSelect customerId="k1" propertyId="p1" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Keine Auswahl"),
      expect.stringContaining("Max Objekt"),
      expect.stringContaining("Max Kunde"),
    ]);
  });

  it("lists a contact that is in both lists once, under the property", async () => {
    contacts.customer = [c("c1", "Kunde"), c("c2", "Objekt")];
    renderWithProviders(<ContactSelect customerId="k1" propertyId="p1" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Keine Auswahl"),
      expect.stringContaining("Max Objekt"),
      expect.stringContaining("Max Kunde"),
    ]);
  });

  it("reports the picked contact", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ContactSelect customerId="k1" propertyId={null} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Max Kunde"));
    expect(onChange).toHaveBeenCalledWith("c1");
  });
});
