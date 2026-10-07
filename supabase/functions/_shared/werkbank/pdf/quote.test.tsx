/** @jsxImportSource npm:react@18.3.1 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQuotePdfData,
  type CustomerRow,
  type ItemRow,
  type ProfileRow,
  type PropertyRow,
  type QuotePdfInput,
  type QuoteRow,
  type TotalsRow,
} from "./quoteData.ts";
import { QuoteDocument, renderQuotePdf } from "./quoteDocument.tsx";

const quote = {
  quote_no: "A-0042", valid_until: "2026-11-06", subject: "Badsanierung", intro_text: "Vielen Dank.",
  closing_text: "Wir freuen uns.", payment_terms_text: "14 Tage netto.", discount_percent: 0, sent_at: null,
} as QuoteRow;
const customer = {
  kind: "private", first_name: "Anna", last_name: "Muster", company_name: null,
  street: "Hauptstr. 1", postal_code: "80331", city: "München",
} as CustomerRow;
const hv = { ...customer, kind: "property_manager", company_name: "Hausverwaltung Nord" } as CustomerRow;
const property = {
  name: "Haus Eiche", street: "Ahornweg 3", postal_code: "80333", city: "München",
  billing_name: "WEG Ahornweg 3", billing_street: "Postfach 5", billing_postal_code: "80000", billing_city: "München",
} as PropertyRow;
const profile = {
  company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331", city: "München",
} as ProfileRow;
const totals = {
  quote_id: "q", order_id: null,
  net_total: 1000, discount_total: 0, vat_total: 190, gross_total: 1190, labour_total: 400,
  vat_breakdown: [{ rate: 19, net: 1000, discounted_net: 1000, vat: 190 }],
} as TotalsRow;

function item(n: number, kind: string, extra: Partial<ItemRow> = {}): ItemRow {
  return { id: String(n), sort_order: n, kind, name: `Pos ${n}`, quantity: 2, unit_code: "HUR", material_price: 10, labour_price: 5, line_net: 30, ...extra } as ItemRow;
}
const baseItems = [
  item(1, "title", { name: "Bad" }), item(2, "item"), item(3, "text", { name: "Hinweis" }), item(4, "item"),
  item(5, "title", { name: "Küche" }), item(6, "item"),
];
const input = (over: Partial<QuotePdfInput> = {}): QuotePdfInput => ({
  quote, items: baseItems, totals, customer, property: null, profile, ...over,
});

Deno.test("private customer without property: recipient and location use the customer address", () => {
  const d = buildQuotePdfData(input());
  assertEquals(d.recipient.lines, ["Anna Muster", "Hauptstr. 1", "80331 München"]);
  assertEquals(d.location, ["Hauptstr. 1", "80331 München"]);
  assertEquals(d.validUntil, "06.11.2026");
  assertEquals(d.totals.labour, 400);
});

Deno.test("property billing recipient prints vertreten durch", () => {
  const d = buildQuotePdfData(input({ customer: hv, property }));
  assertEquals(d.recipient.lines, ["WEG Ahornweg 3", "vertreten durch Hausverwaltung Nord", "Postfach 5", "80000 München"]);
  assertEquals(d.location[0], "Haus Eiche");
  assertEquals(d.totals.labour, undefined);
});

Deno.test("sections number 1, 1.1, 1.2, 2, 2.1; text rows have no number", () => {
  const d = buildQuotePdfData(input());
  assertEquals(d.sections.map((s) => s.number), ["1", "2"]);
  assertEquals(d.sections[0].rows.map((r) => r.number), ["1.1", undefined, "1.2"]);
  assertEquals(d.sections[1].rows.map((r) => r.number), ["2.1"]);
  assertEquals(d.sections[0].subtotal, 60);
  assertEquals(d.sections[0].rows[0].unit, "Std");
  assertEquals(d.sections[0].rows[0].unitPrice, 15);
});

Deno.test("renders a PDF; 120 items span several pages", async () => {
  const many = [item(0, "title", { name: "Alles" }), ...Array.from({ length: 120 }, (_, i) => item(i + 1, "item"))];
  const bytes = await renderQuotePdf(buildQuotePdfData(input({ items: many })));
  const text = new TextDecoder("latin1").decode(bytes);
  assertEquals(text.slice(0, 4), "%PDF");
  assert((text.match(/\/Type \/Page\b(?!s)/g) ?? []).length > 1);
});

Deno.test("watermark and acceptance block appear in the document tree only when set", async () => {
  const plain = JSON.stringify(QuoteDocument({ data: buildQuotePdfData(input()) }));
  assert(!plain.includes("Entwurf"));
  const marked = JSON.stringify(QuoteDocument({
    data: buildQuotePdfData(input({ watermark: "Entwurf", acceptance: { name: "Anna Muster", decidedAt: "2026-10-08T10:00:00Z", typedName: "Anna Muster" } })),
  }));
  assertStringIncludes(marked, "Entwurf");
  assertStringIncludes(marked, "Angenommen");
  const a = await renderQuotePdf(buildQuotePdfData(input()));
  const b = await renderQuotePdf(buildQuotePdfData(input({ watermark: "Entwurf" })));
  assert(a.length !== b.length);
});
