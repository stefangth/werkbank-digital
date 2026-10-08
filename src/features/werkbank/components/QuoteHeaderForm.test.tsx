import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

vi.mock("./CustomerPicker", () => ({ CustomerPicker: () => null }));
vi.mock("./PropertyPicker", () => ({ PropertyPicker: () => null }));
vi.mock("./ContactSelect", () => ({ ContactSelect: () => null }));

import { QuoteHeaderForm } from "./QuoteHeaderForm";

const quote = {
  customer_id: "c1", property_id: null, contact_id: null, subject: null, location_note: null, discount_percent: 0,
  intro_text: null, closing_text: null, payment_terms_text: null, valid_until: "2026-11-07",
};

describe("QuoteHeaderForm hints", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("explains every preset field of a draft", () => {
    renderWithProviders(<QuoteHeaderForm quote={quote as never} readOnly={false} names={{ customer: null, property: null }} onPatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Heute plus die Gültigkeit aus Einstellungen, Firma/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Kommt aus Einstellungen, Firma, sofern dort ein Text steht\. Du kannst ihn hier für dieses Angebot ändern/ })).toHaveLength(3);
  });
});
