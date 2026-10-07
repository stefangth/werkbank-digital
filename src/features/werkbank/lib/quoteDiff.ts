import type { DocumentItem } from "../data/documentItems";

const cents = (n: number | null) => Math.round((n ?? 0) * 100);
const same = (a: number | null, b: number | null) => cents(a) === cents(b);

/** Compares an order's lines with the quote it came from (`source_item_id`). `changed` are order
 *  items whose quantity, labour or material price or VAT rate differs from their source line, `added` are
 *  order items without a source, `removedCount` the quote items no order line points at. Titles
 *  and text blocks are not compared. Prices are compared in cents, quantities and VAT rates exactly. */
export function diffAgainstQuote(
  orderItems: DocumentItem[],
  quoteItems: DocumentItem[],
): { changed: Set<string>; added: Set<string>; removedCount: number } {
  const quoteById = new Map(quoteItems.filter((q) => q.kind === "item").map((q) => [q.id, q]));
  const changed = new Set<string>();
  const added = new Set<string>();
  const kept = new Set<string>();
  for (const item of orderItems) {
    if (item.kind !== "item") continue;
    const source = item.source_item_id ? quoteById.get(item.source_item_id) : undefined;
    if (!item.source_item_id) added.add(item.id);
    else if (source) {
      kept.add(source.id);
      if (item.quantity !== source.quantity || !same(item.labour_price, source.labour_price) || !same(item.material_price, source.material_price)
        || item.vat_rate !== source.vat_rate) {
        changed.add(item.id);
      }
    }
  }
  return { changed, added, removedCount: quoteById.size - kept.size };
}
