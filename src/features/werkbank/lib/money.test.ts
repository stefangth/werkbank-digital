import { describe, it, expect } from "vitest";
import { formatEuro } from "./money";

const plain = (s: string) => s.replace(/\s/g, " ");

describe("formatEuro", () => {
  it("formats German amounts with comma and trailing symbol", () => {
    expect(plain(formatEuro(52.5, "de"))).toBe("52,50 €");
    expect(plain(formatEuro(1234.5, "de-DE"))).toBe("1.234,50 €");
  });
  it("formats English amounts", () => {
    expect(plain(formatEuro(52.5, "en"))).toBe("€52.50");
  });
  it("falls back to German for an empty language tag", () => {
    expect(plain(formatEuro(1, ""))).toBe("1,00 €");
  });
});
