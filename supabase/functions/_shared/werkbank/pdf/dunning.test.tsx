/** @jsxImportSource npm:react@18.3.1 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { BuyerSnapshot, CompanyProfileRow, InvoiceRow, SellerSnapshot } from "../einvoice/invoiceData.ts";
import { buildDunningData } from "./dunningData.ts";
import { DunningDocument, renderDunningPdf } from "./dunningDocument.tsx";

const seller = {
  company_name: "Muster Sanitär", street: "Werkstr. 2", postal_code: "80331", city: "München",
  iban: "DE02120300000000202051", bic: "BYLADEM1001", bank_name: "Testbank",
} as SellerSnapshot;
const buyer = { name: "Anna Muster", street: "Hauptstr. 1", postal_code: "80331", city: "München", property: null } as BuyerSnapshot;
const invoice = {
  invoice_no: "RE-0012", issue_date: "2026-08-01", due_date: "2026-08-15", seller_snapshot: seller, buyer_snapshot: buyer,
} as unknown as InvoiceRow;
const profile = {} as CompanyProfileRow;
const build = (stage: 1 | 2 | 3, draft = false, earlier: { stage: 1 | 2 | 3; notice_date: string }[] = []) =>
  buildDunningData({
    notice: { stage, notice_date: "2026-10-08", payment_deadline: "2026-10-15", invoice_gross: 1190, paid_amount: 100, open_amount: 1090 },
    invoice, propertyName: "Haus Eiche", profile, earlier, draft,
  });
// The text layer is asserted on the element tree: pdfText.ts cannot decode the Geist subsets in
// every environment (the Teil 4 invoice text tests fail the same way), so the rendered bytes are
// only checked for being a PDF.
const text = (d: ReturnType<typeof build>) => {
  const out: string[] = [];
  JSON.stringify(DunningDocument({ data: d }), (_k, v) => (typeof v === "string" ? (out.push(v), v) : v));
  return out.join(" ").replace(/\s+/g, " ");
};

Deno.test("renders a PDF with title, amounts, deadline and reference", async () => {
  const bytes = await renderDunningPdf(build(1));
  assertEquals(new TextDecoder("latin1").decode(bytes.slice(0, 4)), "%PDF");
  const stamped = new TextDecoder("latin1").decode(await renderDunningPdf(build(1, true)));
  assert(stamped.length !== new TextDecoder("latin1").decode(bytes).length, "draft differs from final");
  const t = text(build(1));
  assertStringIncludes(t, "Zahlungserinnerung");
  assertStringIncludes(t, "1.090,00");
  assertStringIncludes(t, "15.10.2026");
  assertStringIncludes(t, "RE-0012 vom 01.08.2026");
  assertStringIncludes(t, "Haus Eiche");
  assertStringIncludes(t, "Sehr geehrte Damen und Herren");
  assertStringIncludes(t, "Mit freundlichen Grüßen");
  assert(!t.includes("blieben bisher"));
});

Deno.test("stage 2 names the earlier notices; draft prints the watermark", async () => {
  const plain = text(build(2, false, [{ stage: 1, notice_date: "2026-09-01" }]));
  assertStringIncludes(plain, "Zahlungserinnerung vom 01.09.2026");
  assertStringIncludes(plain, "blieb bisher ohne vollständige Zahlung");
  const two = text(build(3, false, [{ stage: 2, notice_date: "2026-09-20" }, { stage: 1, notice_date: "2026-09-01" }]));
  assertStringIncludes(two, "Unsere Zahlungserinnerung vom 01.09.2026 und unsere 1. Mahnung vom 20.09.2026 blieben bisher ohne vollständige Zahlung");
  assert(!plain.includes("ENTWURF"));
  assertStringIncludes(text(build(1, true)), "ENTWURF");
});
