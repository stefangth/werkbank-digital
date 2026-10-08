// Test support: fixed invoices for the Factur-X tests and the einvoice-validate CI script.
// Every case goes through buildInvoiceData from hand-written rows; the totals rows are what
// the werkbank.document_totals view returns for those items (the discount case is the
// Task 4 pgTAP case). Not used by any production code path.
import type { Database } from "../../database.types.ts";
import { type BuyerSnapshot, buildInvoiceData, type InvoiceData, type SellerSnapshot } from "./invoiceData.ts";

type W = Database["werkbank"];
type Inv = W["Tables"]["invoices"]["Row"];
type Item = W["Tables"]["document_items"]["Row"];
type Totals = W["Views"]["document_totals"]["Row"];

export const fixtureSeller: SellerSnapshot = {
  company_name: "Muster Elektro", legal_form: "GmbH", street: "Werkstrasse 1", postal_code: "10115", city: "Berlin",
  country_code: "DE", phone: "030123456", email: "info@muster-elektro.example", website: null, tax_number: "12/345/67890",
  vat_id: "DE123456789", register_court: "Berlin", register_number: "HRB 12345", iban: "DE02120300000000202051",
  bic: "BYLADEM1001", bank_name: "Bank", logo_path: null, quote_intro: null, quote_closing: null, payment_terms_text: null,
  quote_validity_days: 30, invoice_intro: null, invoice_closing: null, payment_due_days: 14,
};

export const fixtureBuyer: BuyerSnapshot = {
  name: "Beispiel Hausverwaltung", street: "Hauptstrasse 5", postal_code: "20095", city: "Hamburg", country_code: "DE",
  customer_no: "K-0001", vat_id: null, invoice_email: "rechnung@beispiel.example", is_private: false,
  billing_override: false, property: null,
};

const invoiceRow = (extra: Partial<Inv> = {}): Inv => ({
  buyer_snapshot: fixtureBuyer as unknown as Inv["buyer_snapshot"],
  seller_snapshot: fixtureSeller as unknown as Inv["seller_snapshot"],
  cancels_invoice_id: null, closing_text: null, contact_id: null, created_at: "", customer_id: "c", discount_percent: 0,
  due_date: "2026-10-22", id: "i1", intro_text: null, invoice_no: "RE-0001", issue_date: "2026-10-08",
  issued_at: null, location_note: null, order_id: null, org_id: "o", payment_due_days: 14,
  payment_terms_text: "Zahlbar innerhalb von 14 Tagen ohne Abzug.", pdf_path: null, pdf_sha256: null, property_id: null,
  sent_at: null, sent_to: null, service_date_from: "2026-10-01", service_date_to: null, status: "issued",
  subject: "Elektroinstallation", type: "invoice", updated_at: "", ...extra,
});

let seq = 0;
const itemRow = (name: string, quantity: number, unitPrice: number, lineNet: number, vatRate: number, unitCode = "H87"): Item => {
  seq += 1;
  return {
    catalog_item_id: null, created_at: "", description: null, id: `it${seq}`, invoice_id: "i1", item_no: null, kind: "item",
    labour_price: unitPrice, line_net: lineNet, material_price: 0, name, order_id: null, org_id: "o", quantity,
    quote_id: null, sort_order: seq, source_item_id: null, unit_code: unitCode, updated_at: "", vat_rate: vatRate,
  };
};

const totalsRow = (
  net: number, discount: number, vat: number, gross: number,
  breakdown: Array<{ rate: number; net: number; discounted_net: number; vat: number }>,
): Totals => ({
  discount_total: discount, gross_total: gross, invoice_id: "i1", labour_total: 0, net_total: net, order_id: null,
  quote_id: null, vat_total: vat, vat_breakdown: breakdown,
});

/** One line, 2 h x 50.00 at 19 %. Seller with tax number only (BT-32). */
export function plainInvoice(): InvoiceData {
  return buildInvoiceData({
    invoice: invoiceRow({ seller_snapshot: { ...fixtureSeller, vat_id: null } as unknown as Inv["seller_snapshot"] }),
    items: [itemRow("Arbeitsleistung Elektroinstallation", 2, 50, 100, 19, "HUR")],
    totals: totalsRow(100, 0, 19, 119, [{ rate: 19, net: 100, discounted_net: 100, vat: 19 }]),
  });
}

/** Review Focus 4: three 0.335 x 1.00 at 19 %, one 3 x 12.50 at 7 %, 3 % discount (view values). */
export function discountInvoice(): InvoiceData {
  return buildInvoiceData({
    invoice: invoiceRow({ discount_percent: 3, service_date_to: "2026-10-05" }),
    items: [
      itemRow("Kabel NYM-J 3x1,5", 0.335, 1, 0.34, 19, "MTR"),
      itemRow("Kabel NYM-J 5x1,5", 0.335, 1, 0.34, 19, "MTR"),
      itemRow("Kabel H07V-K", 0.335, 1, 0.34, 19, "MTR"),
      itemRow("Fachbuch Elektroinstallation", 3, 12.5, 37.5, 7),
    ],
    totals: totalsRow(38.52, 1.15, 2.74, 40.11, [
      { rate: 19, net: 1.02, discounted_net: 0.99, vat: 0.19 },
      { rate: 7, net: 37.5, discounted_net: 36.38, vat: 2.55 },
    ]),
  });
}

/** 19 %, 7 % and 0 % lines, no discount. */
export function mixedRatesInvoice(): InvoiceData {
  return buildInvoiceData({
    invoice: invoiceRow({ invoice_no: "RE-0003" }),
    items: [
      itemRow("Montage", 2, 50, 100, 19, "HUR"),
      itemRow("Fachliteratur", 10, 5, 50, 7),
      itemRow("Photovoltaikmodul", 1, 20, 20, 0),
    ],
    totals: totalsRow(170, 0, 22.5, 192.5, [
      { rate: 19, net: 100, discounted_net: 100, vat: 19 },
      { rate: 7, net: 50, discounted_net: 50, vat: 3.5 },
      { rate: 0, net: 20, discounted_net: 20, vat: 0 },
    ]),
  });
}

/** Full reversal of the plain invoice: positive amounts, type cancellation, original referenced. */
export function cancellationInvoice(): InvoiceData {
  return buildInvoiceData({
    invoice: invoiceRow({ type: "cancellation", invoice_no: "RE-0002", issue_date: "2026-10-09", due_date: "2026-10-23", status: "issued" }),
    items: [itemRow("Arbeitsleistung Elektroinstallation", 2, 50, 100, 19, "HUR")],
    totals: totalsRow(100, 0, 19, 119, [{ rate: 19, net: 100, discounted_net: 100, vat: 19 }]),
    preceding: { invoice_no: "RE-0001", issue_date: "2026-10-08" },
  });
}
