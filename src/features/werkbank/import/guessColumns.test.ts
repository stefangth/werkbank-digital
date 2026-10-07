import { describe, it, expect } from "vitest";
import { guessColumns } from "./guessColumns";
import { CATALOG_IMPORT, CUSTOMER_IMPORT, PROPERTY_IMPORT } from "./specs";

const fields = CUSTOMER_IMPORT.fields;

describe("guessColumns", () => {
  it.each(["PLZ", "Postleitzahl", "plz "])("maps %j to postal_code", (header) => {
    expect(guessColumns(["Name", header, "Ort"], fields).postal_code).toBe(header);
  });

  it.each(["Straße", "Strasse", "STRASSE"])("maps %j to street", (header) => {
    expect(guessColumns([header], fields).street).toBe(header);
  });

  it("maps Firma to company_name and Kundennr. to customer_no", () => {
    const mapping = guessColumns(["Firma", "Kundennr."], fields);
    expect(mapping.company_name).toBe("Firma");
    expect(mapping.customer_no).toBe("Kundennr.");
  });

  it("matches English headers too", () => {
    const mapping = guessColumns(["Company", "Zip Code", "City", "Last Name"], fields);
    expect(mapping).toMatchObject({ company_name: "Company", postal_code: "Zip Code", city: "City", last_name: "Last Name" });
  });

  it("returns null for every unmatched field", () => {
    const mapping = guessColumns(["Irgendwas"], fields);
    expect(Object.keys(mapping).sort()).toEqual(fields.map((f) => f.key).sort());
    expect(Object.values(mapping).every((v) => v === null)).toBe(true);
  });

  it("uses each header at most once", () => {
    const twoFields = [
      { key: "a", labelKey: "a", required: false, aliases: ["Nr"], kind: "text" as const },
      { key: "b", labelKey: "b", required: false, aliases: ["Nr."], kind: "text" as const },
    ];
    expect(guessColumns(["Nr"], twoFields)).toEqual({ a: "Nr", b: null });
    expect(guessColumns(["Nr", "nr."], twoFields)).toEqual({ a: "Nr", b: "nr." });
  });

  it("keeps billing and property address columns apart", () => {
    const mapping = guessColumns(["Straße", "Rechnungsstraße", "PLZ", "Rechnungs-PLZ"], PROPERTY_IMPORT.fields);
    expect(mapping).toMatchObject({
      street: "Straße",
      billing_street: "Rechnungsstraße",
      postal_code: "PLZ",
      billing_postal_code: "Rechnungs-PLZ",
    });
  });

  it("maps typical catalog headers", () => {
    const mapping = guessColumns(["Art.-Nr.", "Bezeichnung", "Einheit", "Lohn", "Material", "MwSt."], CATALOG_IMPORT.fields);
    expect(mapping).toMatchObject({
      item_no: "Art.-Nr.",
      name: "Bezeichnung",
      unit_code: "Einheit",
      labour_price: "Lohn",
      material_price: "Material",
      vat_rate: "MwSt.",
    });
  });
});
