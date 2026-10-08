import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { toUblInput } from "./facturx.ts";
import { cancellationInvoice, discountInvoice, mixedRatesInvoice, plainInvoice } from "./fixtures.ts";

const inv = (d = plainInvoice()) => toUblInput(d)["ubl:Invoice"];

Deno.test("discount fixture: document totals equal the view values (BR-CO-10/13/15)", () => {
  const u = inv(discountInvoice());
  const t = u["cac:LegalMonetaryTotal"];
  assertEquals(t["cbc:LineExtensionAmount"], "38.52"); // BT-106
  assertEquals(t["cbc:AllowanceTotalAmount"], "1.15"); // BT-107
  assertEquals(t["cbc:TaxExclusiveAmount"], "37.37"); // BT-109
  assertEquals(u["cac:TaxTotal"][0]["cbc:TaxAmount"], "2.74"); // BT-110
  assertEquals(t["cbc:TaxInclusiveAmount"], "40.11"); // BT-112
  assertEquals(t["cbc:PayableAmount"], "40.11"); // BT-115
  assertEquals(t["cbc:PayableAmount@currencyID"], "EUR");
});

Deno.test("discount fixture: one allowance per VAT rate that sums to the discount", () => {
  const a = inv(discountInvoice())["cac:AllowanceCharge"] ?? [];
  assertEquals(a.map((x) => [x["cbc:ChargeIndicator"], x["cbc:Amount"], x["cac:TaxCategory"]["cbc:ID"], x["cac:TaxCategory"]["cbc:Percent"], x["cbc:AllowanceChargeReason"]]), [
    ["false", "0.03", "S", "19", "Rabatt"],
    ["false", "1.12", "S", "7", "Rabatt"],
  ]);
});

Deno.test("discount fixture: BG-23 taxable amounts are the discounted nets", () => {
  const sub = inv(discountInvoice())["cac:TaxTotal"][0]["cac:TaxSubtotal"] ?? [];
  assertEquals(sub.map((x) => [x["cbc:TaxableAmount"], x["cbc:TaxAmount"], x["cac:TaxCategory"]["cbc:ID"], x["cac:TaxCategory"]["cbc:Percent"]]), [
    ["0.99", "0.19", "S", "19"],
    ["36.38", "2.55", "S", "7"],
  ]);
});

Deno.test("discount fixture: lines keep the stored line net, quantity and rec 20 unit", () => {
  const l = inv(discountInvoice())["cac:InvoiceLine"];
  assertEquals(l.length, 4);
  assertEquals(l[0]["cbc:InvoicedQuantity"], "0.335");
  assertEquals(l[0]["cbc:InvoicedQuantity@unitCode"], "MTR");
  assertEquals(l[0]["cbc:LineExtensionAmount"], "0.34");
  assertEquals(l[0]["cac:Price"]["cbc:PriceAmount"], "1.00");
  assertEquals(l[3]["cbc:InvoicedQuantity@unitCode"], "H87");
  assertEquals(l[3]["cac:Item"]["cac:ClassifiedTaxCategory"]["cbc:Percent"], "7");
});

Deno.test("a service period becomes BG-14 with BT-72 at its end, a single date BT-72", () => {
  const p = inv(discountInvoice());
  assertEquals(p["cac:InvoicePeriod"], { "cbc:StartDate": "2026-10-01", "cbc:EndDate": "2026-10-05" });
  assertEquals(p["cac:Delivery"], { "cbc:ActualDeliveryDate": "2026-10-05" });
  const d = inv();
  assertEquals(d["cac:Delivery"], { "cbc:ActualDeliveryDate": "2026-10-01" });
  assertEquals(d["cac:InvoicePeriod"], undefined);
});

Deno.test("plain invoice: header, payment and seller tax number", () => {
  const u = inv();
  assertEquals(u["cbc:InvoiceTypeCode"], "380");
  assertEquals(u["cbc:CustomizationID"], "urn:cen.eu:en16931:2017");
  assertEquals(u["cbc:ID"], "RE-0001");
  assertEquals(u["cbc:IssueDate"], "2026-10-08");
  assertEquals(u["cbc:DueDate"], "2026-10-22"); // BT-9
  assertEquals(u["cbc:DocumentCurrencyCode"], "EUR");
  assertEquals(u["cac:PaymentTerms"], { "cbc:Note": "Zahlbar innerhalb von 14 Tagen ohne Abzug." }); // BT-20
  assertEquals(u["cac:PaymentMeans"], [{
    "cbc:PaymentMeansCode": "58",
    "cac:PayeeFinancialAccount": { "cbc:ID": "DE02120300000000202051", "cac:FinancialInstitutionBranch": { "cbc:ID": "BYLADEM1001" } },
  }]);
  assertEquals(u["cac:AllowanceCharge"], undefined);
  assertEquals(u["cac:LegalMonetaryTotal"]["cbc:AllowanceTotalAmount"], undefined);
  const seller = u["cac:AccountingSupplierParty"]["cac:Party"];
  assertEquals(seller["cac:PartyTaxScheme"], [{ "cbc:CompanyID": "12/345/67890", "cac:TaxScheme": { "cbc:ID": "FC" } }]); // BT-32
  assertEquals(seller["cac:PartyLegalEntity"]["cbc:RegistrationName"], "Muster Elektro GmbH");
  assertEquals(seller["cac:PostalAddress"]["cac:Country"]["cbc:IdentificationCode"], "DE");
});

Deno.test("seller VAT id comes first (BT-31), tax number second (BT-32)", () => {
  const seller = inv(mixedRatesInvoice())["cac:AccountingSupplierParty"]["cac:Party"];
  assertEquals(seller["cac:PartyTaxScheme"], [
    { "cbc:CompanyID": "DE123456789", "cac:TaxScheme": { "cbc:ID": "VAT" } },
    { "cbc:CompanyID": "12/345/67890", "cac:TaxScheme": { "cbc:ID": "FC" } },
  ]);
});

Deno.test("buyer comes from the snapshot", () => {
  const b = inv()["cac:AccountingCustomerParty"]["cac:Party"];
  assertEquals(b["cac:PartyLegalEntity"]["cbc:RegistrationName"], "Beispiel Hausverwaltung");
  assertEquals(b["cac:PostalAddress"], {
    "cbc:StreetName": "Hauptstrasse 5", "cbc:CityName": "Hamburg", "cbc:PostalZone": "20095",
    "cac:Country": { "cbc:IdentificationCode": "DE" },
  });
  assertEquals(b["cac:PartyIdentification"], { "cbc:ID": "K-0001" });
  assertEquals(b["cac:PartyTaxScheme"], undefined);
});

Deno.test("cancellation: type 381 with the original in the billing reference", () => {
  const u = inv(cancellationInvoice());
  assertEquals(u["cbc:InvoiceTypeCode"], "381");
  assertEquals(u["cac:BillingReference"], [{ "cac:InvoiceDocumentReference": { "cbc:ID": "RE-0001", "cbc:IssueDate": "2026-10-08" } }]);
  assertEquals(u["cac:LegalMonetaryTotal"]["cbc:PayableAmount"], "119.00");
  assertEquals(inv()["cac:BillingReference"], undefined);
});

Deno.test("mixed 19/7/0: three BG-23 entries, the 0 % one with category Z", () => {
  const u = inv(mixedRatesInvoice());
  const sub = u["cac:TaxTotal"][0]["cac:TaxSubtotal"] ?? [];
  assertEquals(sub.map((x) => [x["cac:TaxCategory"]["cbc:ID"], x["cac:TaxCategory"]["cbc:Percent"], x["cbc:TaxableAmount"], x["cbc:TaxAmount"]]), [
    ["S", "19", "100.00", "19.00"],
    ["S", "7", "50.00", "3.50"],
    ["Z", "0", "20.00", "0.00"],
  ]);
  assertEquals(u["cac:InvoiceLine"][2]["cac:Item"]["cac:ClassifiedTaxCategory"]["cbc:ID"], "Z");
  assertEquals(u["cac:TaxTotal"][0]["cbc:TaxAmount"], "22.50");
  assertEquals(u["cac:LegalMonetaryTotal"]["cbc:TaxInclusiveAmount"], "192.50");
});

Deno.test("inconsistent totals are rejected instead of producing an invalid e-invoice", () => {
  const d = discountInvoice();
  assertThrows(() => toUblInput({ ...d, totals: { ...d.totals, net: 38.53 } }), Error, "einvoice_totals_mismatch");
  assertThrows(() => toUblInput({ ...d, totals: { ...d.totals, discount: 1.16 } }), Error, "einvoice_totals_mismatch");
  assertThrows(() => toUblInput({ ...d, totals: { ...d.totals, gross: 40.12 } }), Error, "einvoice_totals_mismatch");
});
