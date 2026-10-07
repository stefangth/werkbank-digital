import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { propertySchema, toPropertyRow } from "./property";

const t = ((key: string) => key) as unknown as TFunction;

const base = {
  customer_id: "6f1c2f3e-5a1b-4c3d-9e2f-1a2b3c4d5e6f",
  name: "WEG Musterstr. 5",
  object_no: "",
  street: "Musterstr. 5",
  postal_code: "01067",
  city: "Dresden",
  country_code: "DE",
  has_billing: false,
  billing_name: "",
  billing_street: "",
  billing_postal_code: "",
  billing_city: "",
  billing_country_code: "",
  access_notes: "",
  notes: "",
};
const billing = {
  ...base,
  has_billing: true,
  billing_name: "Verwaltung Nord",
  billing_street: "Ring 1",
  billing_postal_code: "04109",
  billing_city: "Leipzig",
  billing_country_code: "DE",
};

const parse = (v: unknown) => propertySchema(t).safeParse(v);

describe("propertySchema", () => {
  it("accepts a property without billing address, ignoring empty billing fields", () => {
    expect(parse(base).success).toBe(true);
  });

  it("requires customer and name", () => {
    expect(parse({ ...base, customer_id: "" }).success).toBe(false);
    expect(parse({ ...base, name: " " }).success).toBe(false);
  });

  it("checks the property address like a customer's", () => {
    expect(parse({ ...base, postal_code: "1067" }).success).toBe(false);
    expect(parse({ ...base, city: "" }).success).toBe(false);
  });

  it("accepts a complete billing address", () => {
    expect(parse(billing).success).toBe(true);
  });

  it("rejects has_billing with an empty city and reports it on billing_city", () => {
    const r = parse({ ...billing, billing_city: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toEqual(["billing_city"]);
  });

  it("rejects has_billing without a billing name", () => {
    expect(parse({ ...billing, billing_name: " " }).success).toBe(false);
  });

  it("applies the DE postal and country rules to the billing address", () => {
    expect(parse({ ...billing, billing_postal_code: "123" }).success).toBe(false);
    expect(parse({ ...billing, billing_country_code: "de" }).success).toBe(false);
    expect(parse({ ...billing, billing_postal_code: "1010", billing_country_code: "AT" }).success).toBe(true);
  });

  it("does not validate a malformed billing address while has_billing is off", () => {
    expect(parse({ ...base, billing_postal_code: "123", billing_country_code: "x" }).success).toBe(true);
  });
});

describe("toPropertyRow", () => {
  it("sends all billing columns as null when has_billing is off, despite leftover values", () => {
    const row = toPropertyRow({ ...billing, has_billing: false });
    expect(row).toMatchObject({
      billing_name: null,
      billing_street: null,
      billing_postal_code: null,
      billing_city: null,
      billing_country_code: null,
    });
    expect(row).not.toHaveProperty("has_billing");
  });

  it("keeps trimmed billing values when has_billing is on and turns blank optionals into null", () => {
    const row = toPropertyRow({ ...billing, billing_name: " Verwaltung Nord ", name: " WEG ", notes: "  " });
    expect(row).toMatchObject({ billing_name: "Verwaltung Nord", billing_city: "Leipzig", name: "WEG", notes: null, object_no: null, access_notes: null });
    expect(row).not.toHaveProperty("has_billing");
  });
});
