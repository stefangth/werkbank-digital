import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { catalogItemSchema, toCatalogItemRow } from "./catalogItem";

const t = ((key: string) => key) as unknown as TFunction;

const valid = {
  item_no: "A-1",
  name: "Heizkörper",
  description: "",
  category: "",
  unit_code: "H87",
  labour_price: "12,50",
  material_price: "12.5",
  vat_rate: "19",
};

describe("catalogItemSchema", () => {
  it("accepts comma and dot prices and turns both into 12.5", () => {
    const parsed = catalogItemSchema(t).parse(valid);
    const row = toCatalogItemRow(parsed);
    expect(row.labour_price).toBe(12.5);
    expect(row.material_price).toBe(12.5);
    expect(row.vat_rate).toBe(19);
  });

  it("rejects a negative price", () => {
    expect(catalogItemSchema(t).safeParse({ ...valid, labour_price: "-1" }).success).toBe(false);
  });

  it("rejects a price with three decimals", () => {
    expect(catalogItemSchema(t).safeParse({ ...valid, material_price: "1,234" }).success).toBe(false);
  });

  it("rejects an unknown unit", () => {
    expect(catalogItemSchema(t).safeParse({ ...valid, unit_code: "XYZ" }).success).toBe(false);
  });

  it("accepts an empty item number and stores it as null", () => {
    const parsed = catalogItemSchema(t).safeParse({ ...valid, item_no: "  " });
    expect(parsed.success).toBe(true);
    expect(toCatalogItemRow(catalogItemSchema(t).parse({ ...valid, item_no: "" })).item_no).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(catalogItemSchema(t).safeParse({ ...valid, name: "  " }).success).toBe(false);
  });

  it("rejects a vat rate outside 19, 7 and 0", () => {
    expect(catalogItemSchema(t).safeParse({ ...valid, vat_rate: "16" }).success).toBe(false);
    expect(catalogItemSchema(t).safeParse({ ...valid, vat_rate: "0" }).success).toBe(true);
  });
});

describe("toCatalogItemRow", () => {
  it("sends blanks as null, never org_id or net_price", () => {
    const row = toCatalogItemRow(catalogItemSchema(t).parse(valid));
    expect(row.description).toBeNull();
    expect(row.category).toBeNull();
    expect(row).not.toHaveProperty("org_id");
    expect(row).not.toHaveProperty("net_price");
  });
});
