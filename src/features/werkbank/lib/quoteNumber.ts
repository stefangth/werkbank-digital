import type { DocumentItem } from "../data/documentItems";

/** `A-0042` for version 1, `A-0042-2` from version 2. */
export function formatQuoteNumber(quoteNo: string, version: number): string {
  return version > 1 ? `${quoteNo}-${version}` : quoteNo;
}

/** Title id to the sum of `line_net` of the items up to the next title. Items before the first
 *  title belong to no section. Sums are rounded to cents. */
export function sectionSubtotals(items: DocumentItem[]): Map<string, number> {
  const cents = new Map<string, number>();
  let current: string | null = null;
  for (const it of items) {
    if (it.kind === "title") {
      current = it.id;
      cents.set(it.id, 0);
    } else if (it.kind === "item" && current) {
      cents.set(current, (cents.get(current) ?? 0) + Math.round((it.line_net ?? 0) * 100));
    }
  }
  return new Map([...cents].map(([id, c]) => [id, c / 100]));
}
