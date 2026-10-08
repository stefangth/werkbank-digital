import { assertEquals } from "jsr:@std/assert@1";
import type { BuyerSnapshot, CompanyProfileRow, InvoiceRow, SellerSnapshot } from "../einvoice/invoiceData.ts";
import { buildDunningData } from "./dunningData.ts";

const seller = { company_name: "Muster Sanitär", street: "Werkstr. 2", postal_code: "80331", city: "München", iban: "DE02120300000000202051" } as SellerSnapshot;
const buyer = { name: "Anna Muster", street: "Hauptstr. 1", postal_code: "80331", city: "München" } as BuyerSnapshot;
const invoice = {
  invoice_no: "RE-0012", issue_date: "2026-08-01", due_date: "2026-08-15", seller_snapshot: seller, buyer_snapshot: buyer,
} as unknown as InvoiceRow;
// The live profile differs on purpose: only its stage texts may be used.
const profile = { company_name: "Neuer Name", reminder_text: null, dunning1_text: null, dunning2_text: "Letzte Frist." } as unknown as CompanyProfileRow;
const notice = (stage: 1 | 2 | 3, paid: number) => ({
  stage, notice_date: "2026-10-08", payment_deadline: "2026-10-15", invoice_gross: 1190, paid_amount: paid, open_amount: 1190 - paid,
});
const base = { invoice, propertyName: "Haus Eiche", profile, earlier: [], draft: false };

Deno.test("stage 1 without payment: default text, no earlier notices", () => {
  const d = buildDunningData({ ...base, notice: notice(1, 0) });
  assertEquals(d.title, "Zahlungserinnerung");
  assertEquals(d.text.startsWith("sicher ist Ihnen"), true);
  assertEquals(d.earlierNotices, []);
  assertEquals(d.openAmount, 1190);
  assertEquals(d.invoice, { no: "RE-0012", issueDate: "2026-08-01", dueDate: "2026-08-15", propertyName: "Haus Eiche" });
  assertEquals(d.noticeDate, "2026-10-08");
  assertEquals(d.paymentDeadline, "2026-10-15");
});

Deno.test("stage 2 with partial payment and one earlier notice", () => {
  const d = buildDunningData({ ...base, notice: notice(2, 100), earlier: [{ stage: 1, notice_date: "2026-09-01" }] });
  assertEquals(d.title, "1. Mahnung");
  assertEquals([d.invoiceGross, d.paidAmount, d.openAmount], [1190, 100, 1090]);
  assertEquals(d.earlierNotices, [{ stage: 1, date: "2026-09-01" }]);
});

Deno.test("stage 3 uses the profile text; seller and buyer come from the invoice snapshots", () => {
  const d = buildDunningData({
    ...base, notice: notice(3, 0), draft: true,
    earlier: [{ stage: 2, notice_date: "2026-09-20" }, { stage: 1, notice_date: "2026-09-01" }],
  });
  assertEquals(d.text, "Letzte Frist.");
  assertEquals(d.title, "2. und letzte Mahnung");
  assertEquals(d.seller.company_name, "Muster Sanitär");
  assertEquals(d.buyer, buyer);
  assertEquals(d.draft, true);
  assertEquals(d.earlierNotices.map((e) => e.stage), [1, 2]);
});

Deno.test("written off is derived as gross minus paid minus open, 0 when nothing was written off", () => {
  assertEquals(buildDunningData({ ...base, notice: notice(1, 100) }).writtenOff, 0);
  const d = buildDunningData({
    ...base,
    notice: { stage: 1, notice_date: "2026-10-08", payment_deadline: "2026-10-15", invoice_gross: 1190, paid_amount: 1000.1, open_amount: 149.8 },
  });
  assertEquals(d.writtenOff, 40.1);
});
