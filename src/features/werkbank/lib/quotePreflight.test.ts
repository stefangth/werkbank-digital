import { describe, it, expect } from "vitest";
import { isCompanyProfileComplete } from "./quotePreflight";

const full = {
  company_name: "Muster Bau GmbH",
  street: "Hauptstr. 1",
  postal_code: "01067",
  city: "Dresden",
  email: "info@muster.de",
  tax_number: "201/123/45678",
  vat_id: null,
};

describe("isCompanyProfileComplete", () => {
  it("is false without a profile", () => {
    expect(isCompanyProfileComplete(null)).toBe(false);
  });
  it("is true with name, address, email and a tax number", () => {
    expect(isCompanyProfileComplete(full)).toBe(true);
  });
  it("is true with a VAT id instead of a tax number", () => {
    expect(isCompanyProfileComplete({ ...full, tax_number: null, vat_id: "DE123456789" })).toBe(true);
  });
  it("is false without both tax number and VAT id", () => {
    expect(isCompanyProfileComplete({ ...full, tax_number: " ", vat_id: null })).toBe(false);
  });
  it("is false when name, address part or email is blank", () => {
    for (const key of ["company_name", "street", "postal_code", "city", "email"] as const) {
      expect(isCompanyProfileComplete({ ...full, [key]: "  " })).toBe(false);
      expect(isCompanyProfileComplete({ ...full, [key]: null })).toBe(false);
    }
  });
});
