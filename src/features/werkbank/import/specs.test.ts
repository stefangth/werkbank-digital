import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import de from "../i18n/de.json";
import { CATALOG_IMPORT, CUSTOMER_IMPORT, PROPERTY_IMPORT } from "./specs";

const t = ((key: string) => key) as unknown as TFunction;

const property = {
  customer_no: " K-10001 ",
  name: "WEG Musterstr. 5",
  object_no: "",
  street: "Musterstr. 5",
  postal_code: "01067",
  city: "Dresden",
  country_code: "DE",
  billing_name: "",
  billing_street: "",
  billing_postal_code: "",
  billing_city: "",
  billing_country_code: "DE",
  access_notes: "",
  notes: "",
};

const lookup = (key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], de);

describe("import specs", () => {
  it.each([CUSTOMER_IMPORT, PROPERTY_IMPORT, CATALOG_IMPORT])("$entity has a German label for every field", (spec) => {
    for (const field of spec.fields) expect(typeof lookup(field.labelKey), field.labelKey).toBe("string");
  });

  it.each([CUSTOMER_IMPORT, PROPERTY_IMPORT, CATALOG_IMPORT])("$entity has unique keys and aliases on every field", (spec) => {
    const keys = spec.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of spec.fields) expect(field.aliases.length, field.key).toBeGreaterThan(0);
  });
});

describe("PROPERTY_IMPORT", () => {
  const schema = PROPERTY_IMPORT.schema(t);

  it("requires customer_no", () => {
    expect(PROPERTY_IMPORT.fields.find((f) => f.key === "customer_no")?.required).toBe(true);
    const r = schema.safeParse({ ...property, customer_no: "  " });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual(["import.errors.customerNo"]);
  });

  it("derives has_billing from a non-blank billing name and validates the billing address then", () => {
    expect(schema.parse(property)).toMatchObject({ has_billing: false, customer_no: "K-10001" });
    const r = schema.safeParse({ ...property, billing_name: "Verwaltung Nord" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toEqual(["billing_street", "billing_postal_code", "billing_city"]);
  });

  it("reports the customer number and property errors together", () => {
    const r = schema.safeParse({ ...property, customer_no: "", name: "" });
    expect(r.error?.issues.map((i) => i.message)).toEqual(["import.errors.customerNo", "properties.errors.name"]);
  });

  it("sends customer_no instead of customer_id, billing as null without a billing name", () => {
    const row = PROPERTY_IMPORT.toRpcRow(schema.parse(property));
    expect(row).not.toHaveProperty("customer_id");
    expect(row).not.toHaveProperty("has_billing");
    expect(row).toMatchObject({ customer_no: "K-10001", name: "WEG Musterstr. 5", object_no: null, billing_name: null, billing_country_code: null });
  });

  it("keeps the billing address when a billing name is set", () => {
    const form = schema.parse({
      ...property,
      billing_name: "Verwaltung Nord",
      billing_street: "Ring 1",
      billing_postal_code: "04109",
      billing_city: "Leipzig",
    });
    expect(PROPERTY_IMPORT.toRpcRow(form)).toMatchObject({ billing_name: "Verwaltung Nord", billing_city: "Leipzig", billing_country_code: "DE" });
  });
});

describe("CUSTOMER_IMPORT and CATALOG_IMPORT rows", () => {
  it("sends the customer row of the form schema, omitting a blank customer_no", () => {
    const form = CUSTOMER_IMPORT.schema(t).parse({
      kind: "private",
      company_name: "Alt GmbH",
      first_name: "",
      last_name: "Meier",
      street: "Ring 2",
      postal_code: "04109",
      city: "Leipzig",
      country_code: "DE",
      email: "",
      invoice_email: "",
      phone: "",
      vat_id: "",
      payment_terms_days: "14",
      notes: "",
      customer_no: "",
    });
    const row = CUSTOMER_IMPORT.toRpcRow(form);
    expect(row).toMatchObject({ kind: "private", company_name: null, payment_terms_days: 14 });
    expect(row).not.toHaveProperty("customer_no");
  });

  it("sends catalog prices as numbers", () => {
    const form = CATALOG_IMPORT.schema(t).parse({
      item_no: "A-1",
      name: "Heizkörper",
      description: "",
      category: "",
      unit_code: "H87",
      labour_price: "12.50",
      material_price: "0",
      vat_rate: "19",
    });
    expect(CATALOG_IMPORT.toRpcRow(form)).toMatchObject({ item_no: "A-1", labour_price: 12.5, material_price: 0, vat_rate: 19 });
  });
});
