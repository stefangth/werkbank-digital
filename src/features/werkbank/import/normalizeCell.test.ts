import { describe, it, expect } from "vitest";
import { normalizeCell } from "./normalizeCell";

describe("normalizeCell money", () => {
  it.each([
    [12.5, "12.50"],
    ["12.5", "12.50"],
    ["12,50", "12.50"],
    ["12.50", "12.50"],
    ["1.234,50", "1234.50"],
    ["1234,5", "1234.50"],
    ["14", "14.00"],
    [0, "0.00"],
    [" 12,50 € ", "12.50"],
  ])("turns %j into %j", (input, expected) => {
    expect(normalizeCell(input, "money")).toBe(expected);
  });

  it("leaves blanks and non-amounts for the schema to judge", () => {
    expect(normalizeCell("", "money")).toBe("");
    expect(normalizeCell("abc", "money")).toBe("abc");
    expect(normalizeCell("-1", "money")).toBe("-1");
    // three decimals stay three decimals: the schema rejects them instead of a silent rounding
    expect(normalizeCell("1,234", "money")).toBe("1.234");
    // "1.234" is 1234 in German but 1.234 in English: ambiguous, so the schema rejects it too
    expect(normalizeCell("1.234", "money")).toBe("1.234");
    expect(normalizeCell("1.234.567,00", "money")).toBe("1234567.00");
  });
});

describe("normalizeCell postal_code (Review Focus 1)", () => {
  it("pads a German postal code that Excel stored as a number", () => {
    expect(normalizeCell(1067, "postal_code", "DE")).toBe("01067");
    expect(normalizeCell("1067", "postal_code", "DE")).toBe("01067");
    expect(normalizeCell("01067", "postal_code", "DE")).toBe("01067");
  });

  it("leaves other countries alone", () => {
    expect(normalizeCell("1010", "postal_code", "AT")).toBe("1010");
    expect(normalizeCell("1067", "postal_code")).toBe("1067");
  });

  it("does not pad text that is not a number", () => {
    expect(normalizeCell("D-1067", "postal_code", "DE")).toBe("D-1067");
  });
});

describe("normalizeCell integer and text", () => {
  it("turns numbers into plain digits", () => {
    expect(normalizeCell(14, "integer")).toBe("14");
    expect(normalizeCell("14", "integer")).toBe("14");
    expect(normalizeCell("30.0", "integer")).toBe("30");
  });

  it("trims text and treats missing values as blank", () => {
    expect(normalizeCell("  Dresden ", "text")).toBe("Dresden");
    expect(normalizeCell(undefined, "text")).toBe("");
    expect(normalizeCell(null, "money")).toBe("");
  });
});

describe("normalizeCell enum", () => {
  it.each([
    ["Hausverwaltung", "property_manager"],
    ["HV", "property_manager"],
    ["hv", "property_manager"],
    ["Privat", "private"],
    ["private", "private"],
  ])("maps the customer kind %j to %j", (input, expected) => {
    expect(normalizeCell(input, "enum")).toBe(expected);
  });

  it.each([
    ["Std", "HUR"],
    ["Stk", "H87"],
    ["m", "MTR"],
    ["m²", "MTK"],
    ["m³", "MTQ"],
    ["kg", "KGM"],
    ["l", "LTR"],
    ["pauschal", "LS"],
    ["Pauschal", "LS"],
    ["H87", "H87"],
  ])("maps the unit %j to %j", (input, expected) => {
    expect(normalizeCell(input, "enum")).toBe(expected);
  });

  it.each([
    ["19 %", "19"],
    ["19%", "19"],
    [19, "19"],
    ["7 %", "7"],
    ["0", "0"],
    ["19,00", "19"],
    ["19.0", "19"],
  ])("maps the VAT rate %j to %j", (input, expected) => {
    expect(normalizeCell(input, "enum")).toBe(expected);
  });

  it("passes unknown labels through for the schema to reject", () => {
    expect(normalizeCell(" Firma ", "enum")).toBe("Firma");
  });
});

describe("normalizeCell country", () => {
  it.each([
    ["de", "DE"],
    ["De", "DE"],
    ["Deutschland", "DE"],
    ["germany", "DE"],
    ["D", "DE"],
    ["Österreich", "AT"],
    ["oesterreich", "AT"],
    ["Austria", "AT"],
    ["A", "AT"],
    ["Schweiz", "CH"],
    ["Switzerland", "CH"],
    ["ch", "CH"],
    ["fr", "FR"],
  ])("turns %j into %j", (input, expected) => {
    expect(normalizeCell(input, "country")).toBe(expected);
  });

  it("leaves other names for the schema to reject", () => {
    expect(normalizeCell("Frankreich", "country")).toBe("Frankreich");
    expect(normalizeCell("", "country")).toBe("");
  });
});

describe("normalizeCell vat_id", () => {
  it("uppercases and drops spaces", () => {
    expect(normalizeCell("de 123 456 789", "vat_id")).toBe("DE123456789");
    expect(normalizeCell("", "vat_id")).toBe("");
  });
});

describe("normalizeCell enum percent cells", () => {
  it.each([
    [0.19, "19"],
    ["0.19", "19"],
    ["0.07", "7"],
    [0.07, "7"],
    ["0,19", "19"],
  ])("maps the XLSX percent value %j to %j", (input, expected) => {
    expect(normalizeCell(input, "enum")).toBe(expected);
  });

  it("does not map other fractions", () => {
    expect(normalizeCell("0.16", "enum")).toBe("0.16");
  });
});
