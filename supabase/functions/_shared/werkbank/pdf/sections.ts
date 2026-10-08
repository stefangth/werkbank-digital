// Section and row numbering shared by the quote and invoice PDFs. Pure, no DB access.
import type { Database } from "../../database.types.ts";

type ItemRow = Database["werkbank"]["Tables"]["document_items"]["Row"];

export const UNIT_LABELS: Record<string, string> = {
  HUR: "Std",
  H87: "Stk",
  MTR: "m",
  MTK: "m²",
  MTQ: "m³",
  KGM: "kg",
  LTR: "l",
  LS: "pauschal",
};

export interface QuotePdfRow {
  number?: string;
  kind: "item" | "text";
  name?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  lineNet?: number;
}

export interface QuotePdfSection {
  title?: string;
  number?: string;
  rows: QuotePdfRow[];
  subtotal?: number;
}

export const clean = (v: string | null | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

export function buildSections(items: ItemRow[]): QuotePdfSection[] {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const sections: QuotePdfSection[] = [];
  let current: QuotePdfSection | null = null;
  let sectionNo = 0;
  let rowNo = 0;
  for (const it of sorted) {
    if (it.kind === "title") {
      sectionNo += 1;
      rowNo = 0;
      current = { title: it.name ?? "", number: String(sectionNo), rows: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { rows: [] };
      sections.push(current);
    }
    if (it.kind === "text") {
      current.rows.push({ kind: "text", name: clean(it.name), description: clean(it.description) });
      continue;
    }
    rowNo += 1;
    const unitPrice = (it.material_price ?? 0) + (it.labour_price ?? 0);
    current.rows.push({
      kind: "item",
      number: current.number ? `${current.number}.${rowNo}` : String(rowNo),
      name: clean(it.name),
      description: clean(it.description),
      quantity: it.quantity ?? 0,
      unit: it.unit_code ? (UNIT_LABELS[it.unit_code] ?? it.unit_code) : undefined,
      unitPrice,
      lineNet: it.line_net ?? 0,
    });
  }
  for (const s of sections) {
    if (s.title !== undefined) {
      s.subtotal = Math.round(s.rows.reduce((sum, r) => sum + (r.lineNet ?? 0), 0) * 100) / 100;
    }
  }
  return sections;
}

