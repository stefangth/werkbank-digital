import { describe, expect, it } from "vitest";
import { invoicePreflight, type InvoicePreflightInput } from "./invoicePreflight";

const ok: InvoicePreflightInput = {
  profile: {
    company_name: "Muster GmbH", street: "Weg 1", postal_code: "10115", city: "Berlin",
    email: "a@example.com", tax_number: "12/345/67890", vat_id: null, iban: "DE89370400440532013000",
  },
  itemCount: 2,
  serviceDateFrom: "2026-10-01",
  buyer: { street: "Str. 2", postal_code: "20095", city: "Hamburg" },
  recipients: ["kunde@example.com"],
};

describe("invoicePreflight", () => {
  it("returns no blockers for complete input", () => {
    expect(invoicePreflight(ok)).toEqual([]);
  });
  it.each([
    ["no_items", { itemCount: 0 }],
    ["no_service_date", { serviceDateFrom: null }],
    ["profile_incomplete", { profile: null }],
    ["no_buyer_address", { buyer: { street: "Str. 2", postal_code: " ", city: "Hamburg" } }],
    ["no_buyer_address", { buyer: null }],
    ["no_recipient", { recipients: [] }],
  ] as Array<[string, Partial<InvoicePreflightInput>]>)("flags %s alone", (blocker, patch) => {
    expect(invoicePreflight({ ...ok, ...patch })).toEqual([blocker]);
  });
  it("flags a profile with tax number but empty IBAN", () => {
    expect(invoicePreflight({ ...ok, profile: { ...ok.profile!, iban: " " } })).toEqual(["profile_incomplete"]);
  });
  it("skips no_recipient when recipients is null", () => {
    expect(invoicePreflight({ ...ok, recipients: null })).toEqual([]);
  });
  it("keeps the declared order", () => {
    expect(invoicePreflight({ profile: null, itemCount: 0, serviceDateFrom: null, buyer: null, recipients: [] })).toEqual([
      "no_items", "no_service_date", "profile_incomplete", "no_buyer_address", "no_recipient",
    ]);
  });
});
