// Pure mapping from database rows to the data the quote PDF prints. No DB access here.
import type { Database } from "../../database.types.ts";

type W = Database["werkbank"]["Tables"];
export type QuoteRow = W["quotes"]["Row"];
export type ItemRow = W["document_items"]["Row"];
export type CustomerRow = W["customers"]["Row"];
export type PropertyRow = W["properties"]["Row"];
export type ProfileRow = W["company_profiles"]["Row"];
export type TotalsRow = Database["werkbank"]["Views"]["document_totals"]["Row"];

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

export interface QuoteAcceptance {
  name: string;
  decidedAt: string;
  signaturePngDataUrl?: string;
  typedName?: string;
}

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

export interface QuotePdfData {
  seller: {
    companyName: string;
    legalForm?: string;
    street: string;
    postalCode: string;
    city: string;
    phone?: string;
    email?: string;
    website?: string;
    registerCourt?: string;
    registerNumber?: string;
    taxNumber?: string;
    vatId?: string;
    bankName?: string;
    iban?: string;
    bic?: string;
    logoDataUrl?: string;
  };
  recipient: { lines: string[] };
  location: string[];
  number: string;
  date: string;
  validUntil: string;
  subject: string;
  intro: string;
  closing: string;
  paymentTerms: string;
  sections: QuotePdfSection[];
  totals: {
    net: number;
    discount: number;
    discountPercent: number;
    vat: Array<{ rate: number; net: number; vat: number }>;
    gross: number;
    labour?: number;
  };
  watermark?: "Entwurf";
  acceptance?: QuoteAcceptance;
}

export interface QuotePdfInput {
  quote: QuoteRow;
  items: ItemRow[];
  totals: TotalsRow;
  customer: CustomerRow;
  property: PropertyRow | null;
  profile: ProfileRow;
  logoDataUrl?: string;
  acceptance?: QuoteAcceptance;
  /** Document date, DD.MM.YYYY. Defaults to the sent date, else today. */
  date?: string;
  watermark?: "Entwurf";
}

const clean = (v: string | null | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** "2026-10-07" or an ISO timestamp to "07.10.2026". */
export function formatDateDe(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/** The customer's display name: the company for a property manager, else first and last name. */
export function customerName(c: CustomerRow): string {
  if (c.kind === "property_manager") return clean(c.company_name) ?? "";
  return [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(" ");
}

function cityLine(postal: string | null | undefined, city: string | null | undefined): string {
  return [clean(postal), clean(city)].filter(Boolean).join(" ");
}

function nonEmpty(lines: Array<string | undefined>): string[] {
  return lines.filter((l): l is string => !!l);
}

function recipientLines(customer: CustomerRow, property: PropertyRow | null): string[] {
  const name = customerName(customer);
  if (property && clean(property.billing_name)) {
    return nonEmpty([
      clean(property.billing_name),
      name ? `vertreten durch ${name}` : undefined,
      clean(property.billing_street),
      cityLine(property.billing_postal_code, property.billing_city) || undefined,
    ]);
  }
  return nonEmpty([
    name,
    clean(customer.street),
    cityLine(customer.postal_code, customer.city) || undefined,
  ]);
}

function locationLines(customer: CustomerRow, property: PropertyRow | null): string[] {
  if (property) {
    return nonEmpty([
      clean(property.name),
      clean(property.street),
      cityLine(property.postal_code, property.city) || undefined,
    ]);
  }
  return nonEmpty([clean(customer.street), cityLine(customer.postal_code, customer.city) || undefined]);
}

interface VatEntry {
  rate: number;
  net: number;
  vat: number;
}

function parseVat(raw: unknown): VatEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const o = e as Record<string, unknown>;
    // The view emits the pre-discount net as `net` and the discounted one as `discounted_net`;
    // the PDF prints the discounted net next to the VAT it was computed from.
    const net = Number(o.discounted_net ?? o.net ?? 0);
    return { rate: Number(o.rate ?? 0), net, vat: Number(o.vat ?? 0) };
  });
}

function buildSections(items: ItemRow[]): QuotePdfSection[] {
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

export function buildQuotePdfData(input: QuotePdfInput): QuotePdfData {
  const { quote, items, totals, customer, property, profile } = input;
  const today = new Date().toISOString().slice(0, 10);
  const labour = Number(totals.labour_total ?? 0);
  return {
    seller: {
      companyName: profile.company_name,
      legalForm: clean(profile.legal_form),
      street: profile.street,
      postalCode: profile.postal_code,
      city: profile.city,
      phone: clean(profile.phone),
      email: clean(profile.email),
      website: clean(profile.website),
      registerCourt: clean(profile.register_court),
      registerNumber: clean(profile.register_number),
      taxNumber: clean(profile.tax_number),
      vatId: clean(profile.vat_id),
      bankName: clean(profile.bank_name),
      iban: clean(profile.iban),
      bic: clean(profile.bic),
      logoDataUrl: input.logoDataUrl,
    },
    recipient: { lines: recipientLines(customer, property) },
    location: locationLines(customer, property),
    number: quote.quote_no,
    date: input.date ?? formatDateDe(quote.sent_at ?? today),
    validUntil: formatDateDe(quote.valid_until),
    subject: quote.subject ?? "",
    intro: quote.intro_text ?? "",
    closing: quote.closing_text ?? "",
    paymentTerms: quote.payment_terms_text ?? "",
    sections: buildSections(items),
    totals: {
      net: Number(totals.net_total ?? 0),
      discount: Number(totals.discount_total ?? 0),
      discountPercent: Number(quote.discount_percent ?? 0),
      vat: parseVat(totals.vat_breakdown),
      gross: Number(totals.gross_total ?? 0),
      // The §35a labour share only applies to private customers.
      labour: customer.kind === "private" && labour > 0 ? labour : undefined,
    },
    watermark: input.watermark,
    acceptance: input.acceptance,
  };
}
