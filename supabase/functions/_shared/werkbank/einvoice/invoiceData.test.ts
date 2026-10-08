import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { Database } from "../../database.types.ts";
import {
  buildInvoiceData,
  type BuyerSnapshot,
  draftBuyerSnapshot,
  draftSellerSnapshot,
  type SellerSnapshot,
} from "./invoiceData.ts";

type W = Database["werkbank"];
type Inv = W["Tables"]["invoices"]["Row"];
type Item = W["Tables"]["document_items"]["Row"];
type Totals = W["Views"]["document_totals"]["Row"];

const seller: SellerSnapshot = {
  company_name: "Muster GmbH", legal_form: "GmbH", street: "Weg 1", postal_code: "10115", city: "Berlin",
  country_code: "DE", phone: null, email: "a@muster.de", website: null, tax_number: "12/345/67890",
  vat_id: null, register_court: null, register_number: null, iban: "DE02120300000000202051", bic: null,
  bank_name: null, logo_path: null, quote_intro: null, quote_closing: null, payment_terms_text: null,
  quote_validity_days: 30, invoice_intro: null, invoice_closing: null, payment_due_days: 14,
};
const buyer: BuyerSnapshot = {
  name: "Mueller, Hans", street: "Str. 2", postal_code: "20095", city: "Hamburg", country_code: "DE",
  customer_no: "K-0001", vat_id: null, invoice_email: null, is_private: false, billing_override: false, property: null,
};

const invoice = (extra: Partial<Inv> = {}): Inv => ({
  buyer_snapshot: buyer as unknown as Inv["buyer_snapshot"], seller_snapshot: seller as unknown as Inv["seller_snapshot"],
  cancels_invoice_id: null, closing_text: "Danke", contact_id: null, created_at: "", customer_id: "c", discount_percent: 0,
  due_date: "2026-10-22", id: "i1", intro_text: "Intro", invoice_no: "RE-0001", issue_date: "2026-10-08",
  issued_at: null, location_note: null, order_id: null, org_id: "o", payment_due_days: 14, payment_terms_text: "14 Tage",
  pdf_path: null, pdf_sha256: null, property_id: null, sent_at: null, sent_to: null, service_date_from: "2026-10-01",
  service_date_to: null, status: "issued", subject: "Betreff", type: "invoice", updated_at: "", ...extra,
});
const item = (n: number, kind: string, extra: Partial<Item> = {}): Item => ({
  catalog_item_id: null, created_at: "", description: null, id: `it${n}`, invoice_id: "i1", item_no: null, kind,
  labour_price: 0, line_net: 0, material_price: 0, name: `N${n}`, order_id: null, org_id: "o", quantity: 1,
  quote_id: null, sort_order: n, source_item_id: null, unit_code: "H87", updated_at: "", vat_rate: 19, ...extra,
});
const totals = (extra: Partial<Totals> = {}): Totals => ({
  discount_total: 0, gross_total: 119.01, invoice_id: "i1", labour_total: 40, net_total: 100, order_id: null,
  quote_id: null, vat_total: 19.01, // deliberately odd: must pass through
  vat_breakdown: [{ rate: 19, net: "100", discounted_net: 100, vat: 19.01 }], ...extra,
});
const items = [
  item(1, "title", { name: "Bad" }),
  item(2, "item", { material_price: 60, labour_price: 40, line_net: 100 }),
  item(3, "text", { name: "Hinweis" }),
];

Deno.test("totals pass through from the view row without arithmetic", () => {
  const d = buildInvoiceData({ invoice: invoice(), items, totals: totals() });
  assertEquals(d.totals.net, 100);
  assertEquals(d.totals.vat, [{ rate: 19, net: 100, discountedNet: 100, vat: 19.01 }]);
  assertEquals(d.totals.gross, 119.01);
  assertEquals(d.number, "RE-0001");
  assertEquals(d.dueDate, "2026-10-22");
});

Deno.test("string numerics from supabase-js are coerced", () => {
  const d = buildInvoiceData({ invoice: invoice(), items, totals: totals({ gross_total: "119.01" as unknown as number }) });
  assertEquals(d.totals.gross, 119.01);
});

Deno.test("labour only for a private buyer", () => {
  assertEquals(buildInvoiceData({ invoice: invoice(), items, totals: totals() }).totals.labour, null);
  const priv = invoice({ buyer_snapshot: { ...buyer, is_private: true } as unknown as Inv["buyer_snapshot"] });
  assertEquals(buildInvoiceData({ invoice: priv, items, totals: totals() }).totals.labour, 40);
});

Deno.test("cancellation carries the preceding invoice", () => {
  const d = buildInvoiceData({
    invoice: invoice({ type: "cancellation" }), items, totals: totals(),
    preceding: { invoice_no: "RE-0000", issue_date: "2026-09-01" },
  });
  assertEquals(d.type, "cancellation");
  assertEquals(d.precedingInvoice, { number: "RE-0000", issueDate: "2026-09-01" });
});

Deno.test("sections are numbered and text rows are not lines", () => {
  const d = buildInvoiceData({ invoice: invoice(), items, totals: totals() });
  assertEquals(d.sections[0].number, "1");
  assertEquals(d.sections[0].rows[0].number, "1.1");
  assertEquals(d.sections[0].rows[1].kind, "text");
  assertEquals(d.lines.length, 1);
  assertEquals(d.lines[0], {
    id: "it2", name: "N2", description: null, quantity: 1, unitCode: "H87", unitPrice: 100, lineNet: 100, vatRate: 19,
  });
});

Deno.test("second section numbers 2", () => {
  const d = buildInvoiceData({
    invoice: invoice(),
    items: [...items, item(4, "title", { name: "Dach" }), item(5, "item", { line_net: 5 })],
    totals: totals(),
  });
  assertEquals(d.sections.map((s) => s.number), ["1", "2"]);
  assertEquals(d.sections[1].rows[0].number, "2.1");
});

Deno.test("billing override buyer name comes from the snapshot", () => {
  const b = { ...buyer, name: "Hausverwaltung AG", billing_override: true };
  const d = buildInvoiceData({ invoice: invoice({ buyer_snapshot: b as unknown as Inv["buyer_snapshot"] }), items, totals: totals() });
  assertEquals(d.buyer.name, "Hausverwaltung AG");
});

Deno.test("draft uses the fallback and is watermarked", () => {
  const d = buildInvoiceData({
    invoice: invoice({ status: "draft", seller_snapshot: null, buyer_snapshot: null, invoice_no: null, issue_date: null, due_date: null, service_date_from: null }),
    items, totals: totals(), draftFallback: { seller, buyer },
  });
  assertEquals(d.watermark, "Entwurf");
  assertEquals(d.seller.company_name, "Muster GmbH");
  assertEquals(d.number, "");
});

Deno.test("issued invoice without snapshots and without fallback throws", () => {
  assertThrows(() => buildInvoiceData({ invoice: invoice({ seller_snapshot: null }), items, totals: totals() }));
});

// Draft fallbacks mirror finalize_invoice (migration 20261008110000): seller = the profile row
// minus org_id/created_at/updated_at, buyer = the jsonb_build_object of v_buyer.
type Profile = W["Tables"]["company_profiles"]["Row"];
type Customer = W["Tables"]["customers"]["Row"];
type Property = W["Tables"]["properties"]["Row"];

// The dunning settings are profile columns too (migration 20261008130000), so finalize_invoice
// snapshots them along with the rest.
const dunningSettings = {
  reminder_after_days: 7, dunning1_after_days: 14, dunning2_after_days: 14, dunning_deadline_days: 7,
  reminder_text: null, dunning1_text: null, dunning2_text: null,
};
const profileRow: Profile = {
  ...seller, ...dunningSettings, org_id: "o", created_at: "2026-01-01", updated_at: "2026-01-02",
};
const customerRow = (extra: Partial<Customer> = {}): Customer => ({
  archived_at: null, city: "Hamburg", company_name: null, country_code: "DE", created_at: "", customer_no: "K-0001",
  email: "kunde@example.com", first_name: "Hans", id: "c", invoice_email: "re@example.com", kind: "private",
  last_name: "Mueller", notes: null, org_id: "o", payment_terms_days: 14, phone: null, postal_code: "20095",
  street: "Str. 2", updated_at: "", vat_id: null, ...extra,
});
const propertyRow = (extra: Partial<Property> = {}): Property => ({
  access_notes: null, archived_at: null, billing_city: null, billing_country_code: null, billing_name: null,
  billing_postal_code: null, billing_street: null, city: "Kiel", country_code: "DE", created_at: "", customer_id: "c",
  id: "p", name: "Haus Nord", notes: null, object_no: null, org_id: "o", postal_code: "24103", street: "Nordweg 3",
  updated_at: "", ...extra,
});

Deno.test("draft seller is the profile without org_id and timestamps", () => {
  assertEquals(draftSellerSnapshot(profileRow), { ...seller, ...dunningSettings });
});

Deno.test("draft buyer of a private customer: last, first and the customer address", () => {
  assertEquals(draftBuyerSnapshot(customerRow(), null), {
    name: "Mueller, Hans", street: "Str. 2", postal_code: "20095", city: "Hamburg", country_code: "DE",
    customer_no: "K-0001", vat_id: null, invoice_email: "re@example.com", is_private: true, billing_override: false,
    property: null,
  });
  assertEquals(draftBuyerSnapshot(customerRow({ first_name: "" }), null).name, "Mueller");
});

Deno.test("draft buyer of a property manager is its company name, with the property", () => {
  const b = draftBuyerSnapshot(customerRow({ kind: "property_manager", company_name: "HV Nord" }), propertyRow());
  assertEquals(b.name, "HV Nord");
  assertEquals(b.is_private, false);
  assertEquals(b.billing_override, false);
  assertEquals(b.street, "Str. 2");
  assertEquals(b.property, { name: "Haus Nord", street: "Nordweg 3", postal_code: "24103", city: "Kiel" });
});

Deno.test("draft buyer uses the property's billing override when billing_name is set", () => {
  const b = draftBuyerSnapshot(customerRow(), propertyRow({
    billing_name: "Eigentuemer GbR", billing_street: "Ostweg 1", billing_postal_code: "10115", billing_city: "Berlin",
    billing_country_code: "DE",
  }));
  assertEquals(
    [b.name, b.street, b.postal_code, b.city, b.country_code, b.billing_override],
    ["Eigentuemer GbR", "Ostweg 1", "10115", "Berlin", "DE", true],
  );
  assertEquals(b.customer_no, "K-0001");
});
