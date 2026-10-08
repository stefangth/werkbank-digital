import { describe, it, expect } from "vitest";
import { formatEuro, parseEuroInput } from "./money";

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

describe("parseEuroInput", () => {
  it.each([
    ["1.190,50", 1190.5], ["1190,5", 1190.5], ["1190.50", 1190.5], ["1.190", 1190], ["12.345.678", 12345678], ["1190.5", 1190.5], ["  12 ", 12], ["0,01", 0.01],
    ["0.500", 0.5], ["0.5", 0.5], ["1.190,500", 1190.5],
    ["12,345", null], ["-5", null], ["0", null], ["", null], ["abc", null], ["1,2,3", null], ["0.500,5", null], ["0.1234", null],
  ])("%j -> %j", (raw, expected) => {
    expect(parseEuroInput(raw)).toBe(expected);
  });
});
