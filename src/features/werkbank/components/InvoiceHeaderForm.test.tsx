import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

vi.mock("./CustomerPicker", () => ({ CustomerPicker: () => null }));
vi.mock("./PropertyPicker", () => ({ PropertyPicker: () => null }));
vi.mock("./ContactSelect", () => ({ ContactSelect: () => null }));

import { InvoiceHeaderForm } from "./InvoiceHeaderForm";

const invoice = {
  customer_id: "c1", property_id: null, contact_id: null, subject: null, location_note: null, discount_percent: 0,
  intro_text: null, closing_text: null, payment_terms_text: null, service_date_from: "2026-10-01", service_date_to: null,
  payment_due_days: 14, type: "invoice",
};

describe("InvoiceHeaderForm hints", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("explains every preset field of a draft", () => {
    renderWithProviders(<InvoiceHeaderForm invoice={invoice as never} readOnly={false} names={{ customer: null, property: null }} onPatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Vorgabe 14 Tage\. Kommt aus Einstellungen, Firma/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Vorgabe ist der Tag, an dem der Auftrag abgeschlossen wurde/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Kommt aus Einstellungen, Firma, sofern dort ein Text steht\. Du kannst ihn hier für diese Rechnung ändern/ })).toHaveLength(3);
  });
});
