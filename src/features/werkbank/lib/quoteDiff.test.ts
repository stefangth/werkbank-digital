import { describe, it, expect } from "vitest";
import type { DocumentItem } from "../data/documentItems";
import { diffAgainstQuote } from "./quoteDiff";

const item = (over: Partial<DocumentItem>): DocumentItem => ({
  id: "i", kind: "item", name: "Position", description: null, catalog_item_id: null, item_no: null, quantity: 1, unit_code: "H87",
  labour_price: 10, material_price: 5, vat_rate: 19, line_net: 15, sort_order: 0, org_id: "o", quote_id: null, order_id: null,
  source_item_id: null, created_at: "", updated_at: "", ...over,
});

describe("diffAgainstQuote", () => {
  const quote = [item({ id: "q1", quote_id: "q" }), item({ id: "q2", quote_id: "q", quantity: 2 })];

  it("finds nothing for an untouched copy", () => {
    const order = quote.map((q) => item({ id: `o-${q.id}`, order_id: "o", source_item_id: q.id, quantity: q.quantity }));
    const diff = diffAgainstQuote(order, quote);
    expect([...diff.changed]).toEqual([]);
    expect([...diff.added]).toEqual([]);
    expect(diff.removedCount).toBe(0);
  });

  it("marks a changed quantity, labour price or material price", () => {
    const order = [
      item({ id: "o1", source_item_id: "q1", quantity: 3 }),
      item({ id: "o2", source_item_id: "q2", quantity: 2, labour_price: 11 }),
    ];
    expect([...diffAgainstQuote(order, quote).changed].sort()).toEqual(["o1", "o2"]);
    const material = [item({ id: "o1", source_item_id: "q1", material_price: 6 }), item({ id: "o2", source_item_id: "q2", quantity: 2 })];
    expect([...diffAgainstQuote(material, quote).changed]).toEqual(["o1"]);
  });

  it("compares in cents, so float noise is not a change", () => {
    const q = [item({ id: "q1", labour_price: 0.1 + 0.2 })];
    const o = [item({ id: "o1", source_item_id: "q1", labour_price: 0.3 })];
    expect(diffAgainstQuote(o, q).changed.size).toBe(0);
  });

  it("marks items without a source as added, but not titles or text", () => {
    const order = [
      item({ id: "o1", source_item_id: "q1" }),
      item({ id: "o2", source_item_id: "q2", quantity: 2 }),
      item({ id: "o3" }),
      item({ id: "o4", kind: "title", name: "Titel" }),
      item({ id: "o5", kind: "text" }),
    ];
    expect([...diffAgainstQuote(order, quote).added]).toEqual(["o3"]);
  });

  it("counts quote items no order line points at, not titles", () => {
    const withTitle = [...quote, item({ id: "q3", kind: "title", name: "Titel" })];
    const order = [item({ id: "o1", source_item_id: "q1" })];
    expect(diffAgainstQuote(order, withTitle).removedCount).toBe(1);
  });
});
