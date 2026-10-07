import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import de from "../i18n/de.json";
import { CATALOG_IMPORT, CUSTOMER_IMPORT, PROPERTY_IMPORT } from "./specs";
import { validateRows } from "./validateRows";

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

const customer = {
  customer_no: "",
  kind: "",
  company_name: "",
  first_name: "",
  last_name: "",
  street: "Hauptstr. 1",
  postal_code: "01067",
  city: "Dresden",
  country_code: "DE",
  email: "",
  invoice_email: "",
  phone: "",
  vat_id: "",
  payment_terms_days: "14",
  notes: "",
};

describe("CUSTOMER_IMPORT kind", () => {
  const schema = CUSTOMER_IMPORT.schema(t);

  it("does not require a kind column", () => {
    expect(CUSTOMER_IMPORT.fields.find((f) => f.key === "kind")?.required).toBe(false);
  });

  it("derives property_manager from a company name when the kind is blank", () => {
    expect(schema.parse({ ...customer, company_name: "Hausverwaltung Nord" }).kind).toBe("property_manager");
  });

  it("derives private when the kind and the company name are blank", () => {
    expect(schema.parse({ ...customer, first_name: "Anna", last_name: "Meier" }).kind).toBe("private");
  });

  it("keeps a filled kind and still rejects an unknown one", () => {
    expect(schema.parse({ ...customer, kind: "private", company_name: "Ignoriert", last_name: "Meier" }).kind).toBe("private");
    expect(schema.safeParse({ ...customer, kind: "Sonstige", company_name: "X GmbH" }).success).toBe(false);
  });

  it("imports a sheet without an Art column", () => {
    const rows = [
      { Firma: "Hausverwaltung Nord", Vorname: "", Nachname: "", Straße: "Hafenstr. 1", PLZ: "20095", Ort: "Hamburg" },
      { Firma: "", Vorname: "Anna", Nachname: "Meier", Straße: "Lindenweg 3", PLZ: "80331", Ort: "München" },
    ];
    const mapping = { kind: null, company_name: "Firma", first_name: "Vorname", last_name: "Nachname", street: "Straße", postal_code: "PLZ", city: "Ort" };
    const checked = validateRows(rows, mapping, CUSTOMER_IMPORT, t);
    expect(checked.invalid).toEqual([]);
    expect(checked.valid.map((v) => v.form.kind)).toEqual(["property_manager", "private"]);
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

  it("rejects a billing address without a billing name instead of dropping it", () => {
    for (const key of ["billing_street", "billing_postal_code", "billing_city"]) {
      const r = schema.safeParse({ ...property, [key]: key === "billing_postal_code" ? "04109" : "Leipzig" });
      expect(r.success, key).toBe(false);
      expect(r.error?.issues.map((i) => i.message), key).toEqual(["import.errors.billingName"]);
    }
  });

  it("does not count the defaulted billing country as a billing address", () => {
    expect(schema.safeParse({ ...property, billing_country_code: "DE" }).success).toBe(true);
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
