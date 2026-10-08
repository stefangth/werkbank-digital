// Pure mapping from an invoice row, its items, its totals row and its snapshots to the one
// object the PDF and the Factur-X mapping consume. No DB access and no VAT arithmetic here:
// every amount comes from the document_totals view row.
import type { Database } from "../../database.types.ts";
import { buildSections, type QuotePdfSection } from "../pdf/sections.ts";

type W = Database["werkbank"];
export type InvoiceRow = W["Tables"]["invoices"]["Row"];
export type InvoiceItemRow = W["Tables"]["document_items"]["Row"];
export type InvoiceTotalsRow = W["Views"]["document_totals"]["Row"];

/** `werkbank.company_profiles` row minus org_id/created_at/updated_at (see finalize_invoice). */
export interface SellerSnapshot {
  company_name: string;
  legal_form: string | null;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  tax_number: string | null;
  vat_id: string | null;
  register_court: string | null;
  register_number: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  logo_path: string | null;
  quote_intro: string | null;
  quote_closing: string | null;
  payment_terms_text: string | null;
  quote_validity_days: number;
  invoice_intro: string | null;
  invoice_closing: string | null;
  payment_due_days: number;
}

export interface BuyerSnapshot {
  name: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  customer_no: string | null;
  vat_id: string | null;
  invoice_email: string | null;
  is_private: boolean;
  billing_override: boolean;
  property: { name: string | null; street: string | null; postal_code: string | null; city: string | null } | null;
}

export interface InvoiceLine {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  lineNet: number;
  vatRate: number;
}

export interface InvoiceData {
  type: "invoice" | "cancellation";
  number: string;
  issueDate: string;
  dueDate: string;
  serviceFrom: string;
  serviceTo: string | null;
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  subject: string | null;
  intro: string | null;
  closing: string | null;
  paymentTerms: string | null;
  precedingInvoice: { number: string; issueDate: string } | null;
  sections: QuotePdfSection[];
  lines: InvoiceLine[];
  totals: {
    net: number;
    discountPercent: number;
    discount: number;
    vat: Array<{ rate: number; net: number; discountedNet: number; vat: number }>;
    gross: number;
    labour: number | null;
  };
  watermark?: "Entwurf";
}

export interface InvoiceDataInput {
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  totals: InvoiceTotalsRow;
  preceding?: { invoice_no: string; issue_date: string } | null;
  /** Drafts have no snapshots; the caller builds seller and buyer from the live rows. */
  draftFallback?: { seller: SellerSnapshot; buyer: BuyerSnapshot };
}

const berlinToday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseVat(raw: unknown): InvoiceData["totals"]["vat"] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const o = e as Record<string, unknown>;
    const net = Number(o.net ?? 0);
    return {
      rate: Number(o.rate ?? 0),
      net,
      discountedNet: Number(o.discounted_net ?? net),
      vat: Number(o.vat ?? 0),
    };
  });
}

export function buildInvoiceData(input: InvoiceDataInput): InvoiceData {
  const { invoice, items, totals, preceding, draftFallback } = input;
  const isDraft = invoice.status === "draft";
  const seller = (invoice.seller_snapshot as unknown as SellerSnapshot | null) ?? draftFallback?.seller;
  const buyer = (invoice.buyer_snapshot as unknown as BuyerSnapshot | null) ?? draftFallback?.buyer;
  if (!seller || !buyer) throw new Error("invoice_snapshot_missing");

  const issueDate = invoice.issue_date ?? berlinToday();
  const labour = Number(totals.labour_total ?? 0);
  const lines: InvoiceLine[] = [...items]
    .filter((it) => it.kind === "item")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((it) => ({
      id: it.id,
      name: it.name ?? "",
      description: it.description?.trim() ? it.description : null,
      quantity: Number(it.quantity ?? 0),
      unitCode: it.unit_code ?? "H87",
      unitPrice: Number(it.material_price ?? 0) + Number(it.labour_price ?? 0),
      lineNet: Number(it.line_net ?? 0),
      vatRate: Number(it.vat_rate ?? 0),
    }));

  return {
    type: invoice.type === "cancellation" ? "cancellation" : "invoice",
    number: invoice.invoice_no ?? "",
    issueDate,
    dueDate: invoice.due_date ?? addDays(issueDate, invoice.payment_due_days),
    serviceFrom: invoice.service_date_from ?? issueDate,
    serviceTo: invoice.service_date_to,
    seller,
    buyer,
    subject: invoice.subject,
    intro: invoice.intro_text,
    closing: invoice.closing_text,
    paymentTerms: invoice.payment_terms_text,
    precedingInvoice: preceding ? { number: preceding.invoice_no, issueDate: preceding.issue_date } : null,
    sections: buildSections(items),
    lines,
    totals: {
      net: Number(totals.net_total ?? 0),
      discountPercent: Number(invoice.discount_percent ?? 0),
      discount: Number(totals.discount_total ?? 0),
      vat: parseVat(totals.vat_breakdown),
      gross: Number(totals.gross_total ?? 0),
      labour: buyer.is_private && labour > 0 ? labour : null,
    },
    ...(isDraft ? { watermark: "Entwurf" as const } : {}),
  };
}
