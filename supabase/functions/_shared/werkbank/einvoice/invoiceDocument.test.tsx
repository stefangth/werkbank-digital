/** @jsxImportSource npm:react@18.3.1 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { extractPdfText } from "../../hire-order-pdf/pdfText.ts";
import type { BuyerSnapshot, InvoiceData, SellerSnapshot } from "./invoiceData.ts";
import { renderInvoicePdf } from "./invoiceDocument.tsx";

const seller: SellerSnapshot = {
  company_name: "Muster", legal_form: "GmbH", street: "Weg 1", postal_code: "10115", city: "Berlin",
  country_code: "DE", phone: null, email: "a@muster.de", website: null, tax_number: "12/345/67890",
  vat_id: null, register_court: "Berlin", register_number: "HRB 1", iban: "DE02120300000000202051", bic: "BYLADEM1001",
  bank_name: "Bank", logo_path: null, quote_intro: null, quote_closing: null, payment_terms_text: null,
  quote_validity_days: 30, invoice_intro: null, invoice_closing: null, payment_due_days: 14,
};
const buyer: BuyerSnapshot = {
  name: "Hans Mueller", street: "Str. 2", postal_code: "20095", city: "Hamburg", country_code: "DE",
  customer_no: "K-0001", vat_id: null, invoice_email: null, is_private: false, billing_override: false, property: null,
};
const data = (over: Partial<InvoiceData> = {}): InvoiceData => ({
  type: "invoice", number: "RE-0001", issueDate: "2026-10-08", dueDate: "2026-10-22", serviceFrom: "2026-10-01",
  serviceTo: null, seller, buyer, subject: "Badsanierung", intro: "Wir berechnen", closing: "Danke", paymentTerms: "14 Tage netto",
  precedingInvoice: null,
  sections: [{ rows: [{ number: "1", kind: "item", name: "Montage", quantity: 2, unit: "Std", unitPrice: 50, lineNet: 100 }] }],
  lines: [],
  totals: { net: 100, discountPercent: 0, discount: 0, vat: [{ rate: 19, net: 100, discountedNet: 100, vat: 19 }], gross: 119, labour: null },
  ...over,
});
const text = async (d: InvoiceData) => (await extractPdfText(await renderInvoicePdf(d))).replace(/\s+/g, " ");

Deno.test("starts with %PDF and carries the mandatory content", async () => {
  const bytes = await renderInvoicePdf(data());
  assertEquals(new TextDecoder("latin1").decode(bytes.slice(0, 4)), "%PDF");
  const t = await text(data());
  for (const s of ["Rechnung RE-0001", "Leistungsdatum", "01.10.2026", "Fällig am", "22.10.2026", "08.10.2026", "DE02120300000000202051", "12/345/67890", "Hamburg"]) {
    assertStringIncludes(t, s);
  }
  assert(!t.includes("Stornorechnung"));
});

Deno.test("a service period prints from and to", async () => {
  const t = await text(data({ serviceTo: "2026-10-05" }));
  assertStringIncludes(t, "Leistungszeitraum");
  assertStringIncludes(t, "05.10.2026");
});

Deno.test("a cancellation is titled Stornorechnung and names the original", async () => {
  const t = await text(data({ type: "cancellation", number: "RE-0002", precedingInvoice: { number: "RE-0001", issueDate: "2026-09-30" } }));
  assertStringIncludes(t, "Stornorechnung RE-0002");
  assertStringIncludes(t, "zu Rechnung RE-0001 vom 30.09.2026");
});

Deno.test("a cancellation is no payment request: no due date, a reversal sentence, negative totals", async () => {
  const t = await text(data({ type: "cancellation", number: "RE-0002", precedingInvoice: { number: "RE-0001", issueDate: "2026-09-30" } }));
  assert(!t.includes("Fällig am"), "no due date");
  // The extractor drops the "tt" ligature ("Bitte" reads "Bie"), so match on "überweisen".
  assert(!t.includes("überweisen"), "no payment request");
  assert(!t.includes("14 Tage"), "no payment terms");
  assertStringIncludes(t, "Diese Stornorechnung hebt die Rechnung RE-0001 vom 30.09.2026 vollständig auf.");
  assertStringIncludes(t, "-119,00");
  assertStringIncludes(t, "-19,00");
  assertStringIncludes(t, "DE02120300000000202051"); // bank details stay in the footer
});

Deno.test("an invoice keeps the payment request and positive totals", async () => {
  const t = await text(data());
  assertStringIncludes(t, "überweisen Sie den Betrag bis zum 22.10.2026");
  assertStringIncludes(t, "14 Tage");
  assert(!t.includes("-119,00"));
  assert(!t.includes("hebt die Rechnung"));
});

Deno.test("Lohnanteil only for a private buyer", async () => {
  const priv = await text(data({ buyer: { ...buyer, is_private: true }, totals: { ...data().totals, labour: 40 } }));
  assertStringIncludes(priv, "davon Lohnanteil (§35a EStG)");
  assert(!(await text(data())).includes("Lohnanteil"));
});

Deno.test("watermark only when set", async () => {
  assertStringIncludes(await text(data({ watermark: "Entwurf" })), "Entwurf");
  assert(!(await text(data())).includes("Entwurf"));
});

Deno.test("every font is embedded", async () => {
  const raw = new TextDecoder("latin1").decode(await renderInvoicePdf(data()));
  assert(!raw.includes("/BaseFont /Helvetica"), "Helvetica must not appear");
  assert(/\/FontFile2/.test(raw), "embedded font program expected");
  const fonts = [...raw.matchAll(/\/Type \/Font\b[^>]*?\/BaseFont \/(\S+)/g)];
  assert(fonts.length > 0);
});
