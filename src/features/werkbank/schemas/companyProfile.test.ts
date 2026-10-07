import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { companyProfileSchema, toCompanyProfileRow } from "./companyProfile";

const t = ((key: string) => key) as unknown as TFunction;

const base = {
  company_name: "Muster Bau GmbH",
  legal_form: "",
  street: "Hauptstr. 1",
  postal_code: "01067",
  city: "Dresden",
  country_code: "DE",
  phone: "",
  email: "",
  website: "",
  tax_number: "",
  vat_id: "",
  register_court: "",
  register_number: "",
  iban: "",
  bic: "",
  bank_name: "",
  logo_path: "",
  quote_intro: "",
  quote_closing: "",
  payment_terms_text: "",
  quote_validity_days: "30",
};

const parse = (over: Record<string, string> = {}) => companyProfileSchema(t).safeParse({ ...base, ...over });

describe("companyProfileSchema", () => {
  it("accepts a minimal profile", () => {
    expect(parse().success).toBe(true);
  });

  it("normalises an iban with spaces", () => {
    const r = parse({ iban: "de89 3704 0044 0532 0130 00" });
    expect(r.success && r.data.iban).toBe("DE89370400440532013000");
  });

  it("rejects a malformed iban", () => {
    const r = parse({ iban: "12345" });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toBe("company.errors.iban");
  });

  it("rejects a bad VAT id", () => {
    const r = parse({ vat_id: "123" });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toBe("company.errors.vatId");
  });

  it("uppercases a VAT id and strips whitespace before the check", () => {
    const r = parse({ vat_id: " de 123 456 789 " });
    expect(r.success && r.data.vat_id).toBe("DE123456789");
  });

  it("rejects a validity of 0 and 366, accepts 1 and 365", () => {
    expect(parse({ quote_validity_days: "0" }).success).toBe(false);
    expect(parse({ quote_validity_days: "366" }).success).toBe(false);
    expect(parse({ quote_validity_days: "1" }).success).toBe(true);
    expect(parse({ quote_validity_days: "365" }).success).toBe(true);
  });

  it("requires name and address, and a 5 digit German postal code", () => {
    expect(parse({ company_name: " " }).success).toBe(false);
    expect(parse({ street: "" }).success).toBe(false);
    expect(parse({ postal_code: "123" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(parse({ email: "nope" }).success).toBe(false);
  });

  it("requires a dot in the email domain, like the reply-to check of the mail function", () => {
    expect(parse({ email: "info@firma" }).success).toBe(false);
    expect(parse({ email: "info@firma.de" }).success).toBe(true);
  });
});

describe("toCompanyProfileRow", () => {
  it("turns blanks into null and the validity into a number", () => {
    const r = companyProfileSchema(t).parse({ ...base, quote_validity_days: "45", phone: " 0351 1 " });
    const row = toCompanyProfileRow(r);
    expect(row.phone).toBe("0351 1");
    expect(row.email).toBeNull();
    expect(row.iban).toBeNull();
    expect(row.quote_validity_days).toBe(45);
    expect(row.street).toBe("Hauptstr. 1");
  });
});
