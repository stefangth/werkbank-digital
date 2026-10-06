import { describe, it, expect } from "vitest";
import {
  BRANDS,
  DEFAULT_BRAND_KEY,
  brandAppUrl,
  brandForKind,
  composeBrands,
  resolveBrand,
  resolveBrandIn,
  type BrandDef,
} from "./brand";

const SHOWFLOW = BRANDS[DEFAULT_BRAND_KEY];

const testBrand: BrandDef = {
  key: "test_brand",
  name: "Test Brand",
  markSvgPath: "/brand/test.svg",
  emailMarkPath: "/email/test-mark.png",
  faviconPath: "/brand/test-favicon.svg",
  appUrl: "https://test.example",
  hosts: ["test.example"],
  defaultFrom: "Test <hello@test.example>",
};

const otherBrand: BrandDef = { ...testBrand, key: "other_brand", name: "Other", hosts: ["other.example"] };

describe("composeBrands", () => {
  it("keeps core brands first, then module brands", () => {
    expect(Object.keys(composeBrands([SHOWFLOW], [testBrand]))).toEqual(["showflow", "test_brand"]);
  });

  it("throws on a duplicate brand key", () => {
    expect(() => composeBrands([SHOWFLOW], [SHOWFLOW])).toThrow("Duplicate brand: showflow");
    expect(() => composeBrands([SHOWFLOW], [testBrand, testBrand])).toThrow("Duplicate brand: test_brand");
  });
});

describe("showflow brand", () => {
  it("is the default and renders the built-in mark", () => {
    expect(SHOWFLOW).toEqual({
      key: "showflow",
      name: "ShowFlow",
      markSvgPath: null,
      emailMarkPath: "/email/showflow-mark.png",
      faviconPath: "/favicon.svg",
      appUrl: null,
      hosts: [],
      defaultFrom: null,
    });
  });
});

describe("resolveBrandIn order", () => {
  const brands = composeBrands([SHOWFLOW], [testBrand, otherBrand]);
  const none = { hint: null, hostname: "" };

  it("kind wins over hint and host", () => {
    expect(resolveBrandIn(brands, "test_brand", { hint: "other_brand", hostname: "other.example" }).key).toBe("test_brand");
  });

  it("a showflow kind still wins over a module hint and host", () => {
    expect(resolveBrandIn(brands, "showflow", { hint: "test_brand", hostname: "test.example" }).key).toBe("showflow");
  });

  it("hint wins over host", () => {
    expect(resolveBrandIn(brands, null, { hint: "test_brand", hostname: "other.example" }).key).toBe("test_brand");
  });

  it("host match wins over the default, case-insensitively", () => {
    expect(resolveBrandIn(brands, null, { hint: null, hostname: "Test.Example" }).key).toBe("test_brand");
  });

  it("an unknown hint falls through to the host", () => {
    expect(resolveBrandIn(brands, null, { hint: "nope", hostname: "other.example" }).key).toBe("other_brand");
  });

  it("an unknown kind brand key falls through", () => {
    expect(resolveBrandIn(brands, "nope", { hint: "test_brand", hostname: "" }).key).toBe("test_brand");
  });

  it("everything empty or unknown gives showflow", () => {
    expect(resolveBrandIn(brands, null, none)).toBe(SHOWFLOW);
    expect(resolveBrandIn(brands, null, { hint: "nope", hostname: "unknown.example" })).toBe(SHOWFLOW);
  });

  it("ignores inherited object keys as hints", () => {
    expect(resolveBrandIn(brands, null, { hint: "toString", hostname: "" })).toBe(SHOWFLOW);
    expect(resolveBrandIn(brands, "constructor", none)).toBe(SHOWFLOW);
  });
});

describe("resolveBrand and brandForKind (production registry)", () => {
  it("both core kinds resolve to showflow", () => {
    expect(brandForKind("production")).toBe(SHOWFLOW);
    expect(brandForKind("staffing")).toBe(SHOWFLOW);
    expect(resolveBrand({ orgKind: "staffing", hint: null, hostname: "example.com" })).toBe(SHOWFLOW);
  });

  it("no kind, no hint, unknown host gives showflow", () => {
    expect(resolveBrand({ orgKind: null, hint: null, hostname: "localhost" })).toBe(SHOWFLOW);
  });
});

describe("brandAppUrl", () => {
  it("uses the brand url, else the fallback", () => {
    expect(brandAppUrl(testBrand, "https://fallback.example")).toBe("https://test.example");
    expect(brandAppUrl(SHOWFLOW, "https://fallback.example")).toBe("https://fallback.example");
  });
});
