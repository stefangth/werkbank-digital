import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { customerSchema, toCustomerRow } from "./customer";

const t = ((key: string) => key) as unknown as TFunction;

const hv = {
  kind: "property_manager" as const,
  company_name: "Muster Hausverwaltung GmbH",
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
  customer_no: "",
};

const priv = { ...hv, kind: "private" as const, company_name: "", last_name: "Meier", first_name: "Anna" };

const ok = (v: unknown) => customerSchema(t).safeParse(v).success;

describe("customerSchema", () => {
  it("accepts a valid property manager and a valid private customer", () => {
    expect(ok(hv)).toBe(true);
    expect(ok(priv)).toBe(true);
  });

  it("rejects a property manager without company name", () => {
    expect(ok({ ...hv, company_name: "  " })).toBe(false);
  });

  it("rejects a private customer without last name", () => {
    expect(ok({ ...priv, last_name: " " })).toBe(false);
  });

  it("checks the DE postal code but not other countries", () => {
    expect(ok({ ...hv, postal_code: "01067" })).toBe(true);
    expect(ok({ ...hv, postal_code: "1067" })).toBe(false);
    expect(ok({ ...hv, postal_code: "1010", country_code: "AT" })).toBe(true);
  });

  it("rejects a malformed country code", () => {
    expect(ok({ ...hv, country_code: "de" })).toBe(false);
    expect(ok({ ...hv, country_code: "DEU" })).toBe(false);
  });

  it("rejects blank street and city", () => {
    expect(ok({ ...hv, street: " " })).toBe(false);
    expect(ok({ ...hv, city: "" })).toBe(false);
  });

  it("accepts blank emails and rejects malformed ones", () => {
    expect(ok({ ...hv, email: "", invoice_email: "" })).toBe(true);
    expect(ok({ ...hv, email: "a@b.de", invoice_email: "rechnung@b.de" })).toBe(true);
    expect(ok({ ...hv, invoice_email: "x" })).toBe(false);
    expect(ok({ ...hv, email: "a b@c.de" })).toBe(false);
  });

  it("checks the VAT id pattern when set", () => {
    expect(ok({ ...hv, vat_id: "DE123456789" })).toBe(true);
    expect(ok({ ...hv, vat_id: "de123456789" })).toBe(false);
    expect(ok({ ...hv, vat_id: "DE1" })).toBe(false);
  });

  it("accepts payment terms 0 to 365 as digits only", () => {
    expect(ok({ ...hv, payment_terms_days: "0" })).toBe(true);
    expect(ok({ ...hv, payment_terms_days: "365" })).toBe(true);
    expect(ok({ ...hv, payment_terms_days: "400" })).toBe(false);
    expect(ok({ ...hv, payment_terms_days: "-1" })).toBe(false);
    expect(ok({ ...hv, payment_terms_days: "1,5" })).toBe(false);
    expect(ok({ ...hv, payment_terms_days: "" })).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(ok({ ...hv, kind: "company" })).toBe(false);
  });

  it("allows customer_no to be left out", () => {
    const { customer_no: _omit, ...rest } = hv;
    expect(ok(rest)).toBe(true);
  });
});

describe("toCustomerRow", () => {
  const row = (v: object) => toCustomerRow(customerSchema(t).parse(v));

  it("sends company_name null for a private customer with a leftover company name", () => {
    expect(row({ ...priv, company_name: "Alt GmbH" }).company_name).toBeNull();
  });

  it("keeps the names of a property manager as entered", () => {
    const r = row({ ...hv, first_name: "Max", last_name: "Muster" });
    expect(r).toMatchObject({ company_name: "Muster Hausverwaltung GmbH", first_name: "Max", last_name: "Muster" });
  });

  it("sends blank optional fields as null", () => {
    const r = row({ ...hv, vat_id: "", email: " ", notes: "" });
    expect(r.vat_id).toBeNull();
    expect(r.email).toBeNull();
    expect(r.invoice_email).toBeNull();
    expect(r.phone).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.first_name).toBeNull();
  });

  it("omits a blank customer_no so the trigger assigns one", () => {
    expect(row(hv)).not.toHaveProperty("customer_no");
    expect(row({ ...hv, customer_no: "  " })).not.toHaveProperty("customer_no");
    expect(row({ ...hv, customer_no: "ALT-7" }).customer_no).toBe("ALT-7");
  });

  it("sends payment terms as a number and never org_id", () => {
    const r = row({ ...hv, payment_terms_days: "30" });
    expect(r.payment_terms_days).toBe(30);
    expect(r).not.toHaveProperty("org_id");
  });
});
