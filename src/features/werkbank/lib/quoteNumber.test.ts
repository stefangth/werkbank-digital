import { describe, it, expect } from "vitest";
import type { DocumentItem } from "../data/documentItems";
import { formatQuoteNumber, sectionSubtotals } from "./quoteNumber";

describe("formatQuoteNumber", () => {
  it("shows version 1 without a suffix", () => {
    expect(formatQuoteNumber("A-0042", 1)).toBe("A-0042");
  });
  it("appends the version from 2", () => {
    expect(formatQuoteNumber("A-0042", 2)).toBe("A-0042-2");
    expect(formatQuoteNumber("A-0042", 11)).toBe("A-0042-11");
  });
});

const item = (id: string, kind: DocumentItem["kind"], line_net: number | null) => ({ id, kind, line_net }) as DocumentItem;

describe("sectionSubtotals", () => {
  it("sums line_net per title until the next title", () => {
    const subtotals = sectionSubtotals([
      item("t1", "title", null),
      item("i1", "item", 100.5),
      item("i2", "item", 20),
      item("x1", "text", null),
      item("t2", "title", null),
      item("i3", "item", 7),
    ]);
    expect([...subtotals]).toEqual([["t1", 120.5], ["t2", 7]]);
  });
  it("ignores items before the first title and rounds to cents", () => {
    const subtotals = sectionSubtotals([item("i0", "item", 5), item("t1", "title", null), item("i1", "item", 0.1), item("i2", "item", 0.2)]);
    expect([...subtotals]).toEqual([["t1", 0.3]]);
  });
});
