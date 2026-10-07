import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { MAX_IMPORT_ROWS } from "@/lib/artistImport/parseSheet";
import { guessColumns } from "./guessColumns";
import { validateRows } from "./validateRows";
import { CATALOG_IMPORT, CUSTOMER_IMPORT, PROPERTY_IMPORT } from "./specs";

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key)) as unknown as TFunction;

const customerHeaders = ["Kundennr.", "Art", "Firma", "Vorname", "Nachname", "Straße", "PLZ", "Ort"];
const customerMapping = guessColumns(customerHeaders, CUSTOMER_IMPORT.fields);

const row = (cells: string[], headers = customerHeaders) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));

describe("validateRows", () => {
  it("accepts valid rows and normalizes cells as parseSheet delivers them (strings)", () => {
    const rows = [
      row(["K-1", "HV", "Muster GmbH", "", "", "Hauptstr. 1", "1067", "Dresden"]),
      row(["", "Privat", "", "Anna", "Meier", "Ring 2", "04109", "Leipzig"]),
    ];
    const { valid, invalid } = validateRows(rows, customerMapping, CUSTOMER_IMPORT, t);
    expect(invalid).toEqual([]);
    expect(valid.map((v) => v.index)).toEqual([0, 1]);
    expect(valid[0].form).toMatchObject({
      kind: "property_manager",
      company_name: "Muster GmbH",
      postal_code: "01067", // Review Focus 1: the DE default country pads the Excel number
      country_code: "DE",
      payment_terms_days: "14",
      customer_no: "K-1",
    });
  });

  it("puts a private customer without last name into invalid with the schema message", () => {
    const rows = [row(["", "Privat", "", "Anna", "", "Ring 2", "04109", "Leipzig"])];
    const { valid, invalid } = validateRows(rows, customerMapping, CUSTOMER_IMPORT, t);
    expect(valid).toEqual([]);
    expect(invalid).toEqual([{ index: 0, messages: ["customers.errors.lastName"] }]);
  });

  it("treats unmapped columns as blank", () => {
    const mapping = { ...customerMapping, city: null };
    const { invalid } = validateRows([row(["", "HV", "Muster GmbH", "", "", "Hauptstr. 1", "01067", "Dresden"])], mapping, CUSTOMER_IMPORT, t);
    expect(invalid[0].messages).toEqual(["customers.errors.city"]);
  });

  it(`validates at most ${MAX_IMPORT_ROWS} rows and reports the overflow as one entry`, () => {
    const ok = row(["", "HV", "Muster GmbH", "", "", "Hauptstr. 1", "01067", "Dresden"]);
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ok);
    const { valid, invalid } = validateRows(rows, customerMapping, CUSTOMER_IMPORT, t);
    expect(valid).toHaveLength(MAX_IMPORT_ROWS);
    expect(invalid).toEqual([{ index: MAX_IMPORT_ROWS, messages: [`import.errors.tooManyRows {"max":${MAX_IMPORT_ROWS}}`] }]);
  });

  it("pads the billing postal code against the billing country", () => {
    const headers = ["Kundennr.", "Name", "Straße", "PLZ", "Ort", "Rechnungsempfänger", "Rechnungsstraße", "Rechnungs-PLZ", "Rechnungsort", "Rechnungsland"];
    const mapping = guessColumns(headers, PROPERTY_IMPORT.fields);
    const cells = ["K-1", "WEG Ring", "Ring 2", "1067", "Dresden", "Verwaltung Nord", "Am Markt 1", "1010", "Wien", "AT"];
    const { valid, invalid } = validateRows([row(cells, headers)], mapping, PROPERTY_IMPORT, t);
    expect(invalid).toEqual([]);
    expect(valid[0].form).toMatchObject({ postal_code: "01067", billing_postal_code: "1010", billing_country_code: "AT", has_billing: true });
  });

  it("normalizes catalog prices, units and VAT", () => {
    const headers = ["Bezeichnung", "Einheit", "Lohn", "Material", "MwSt."];
    const mapping = guessColumns(headers, CATALOG_IMPORT.fields);
    const { valid, invalid } = validateRows([row(["Heizkörper", "Stk", "12,50", "1.234,50", "7 %"], headers)], mapping, CATALOG_IMPORT, t);
    expect(invalid).toEqual([]);
    expect(valid[0].form).toMatchObject({ unit_code: "H87", labour_price: "12.50", material_price: "1234.50", vat_rate: "7" });
  });
});
