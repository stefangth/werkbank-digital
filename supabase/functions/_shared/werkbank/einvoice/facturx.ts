// Pure mapping from InvoiceData to the @e-invoice-eu/core UBL input (EN 16931). The library
// computes no totals, so every amount comes from InvoiceData (the document_totals view); this
// module only formats them and refuses a set that would break BR-CO-10/13/15 (BR-CO-14 holds
// by construction: BT-110 is the sum of the BG-23 tax amounts).
// The library's schema wants every amount, quantity and percentage as a string.
import type { Invoice } from "npm:@e-invoice-eu/core@3.4.0";
import type { InvoiceData } from "./invoiceData.ts";

type Ubl = Invoice["ubl:Invoice"];
type Country = Ubl["cac:AccountingSupplierParty"]["cac:Party"]["cac:PostalAddress"]["cac:Country"]["cbc:IdentificationCode"];
type VatCategory = { "cbc:ID": "S" | "Z"; "cbc:Percent": string; "cac:TaxScheme": { "cbc:ID": "VAT" } };

const C = "EUR" as const;
const cents = (n: number): number => Math.round(n * 100);
/** Fixed 2 decimals from integer cents, so -0 and float noise never leak into the XML. */
const money = (c: number): string => {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};
const amt = (n: number): string => money(cents(n));
/** Quantity as stored (numeric(12,3)): up to 3 decimals, trailing zeros dropped. */
const qty = (n: number): string => String(Number(n.toFixed(3)));
const pct = (n: number): string => String(Number(n.toFixed(2)));
const filled = (v: string | null | undefined): v is string => !!v?.trim();

function vatCategory(rate: number): VatCategory {
  return { "cbc:ID": rate > 0 ? "S" : "Z", "cbc:Percent": pct(rate), "cac:TaxScheme": { "cbc:ID": "VAT" } };
}

function mismatch(what: string): never {
  throw new Error(`einvoice_totals_mismatch: ${what}`);
}

export function toUblInput(data: InvoiceData): Invoice {
  const { seller, buyer, totals } = data;

  const lineSum = data.lines.reduce((s, l) => s + cents(l.lineNet), 0);
  const rates = totals.vat.map((v) => ({
    rate: v.rate,
    net: cents(v.net),
    taxable: cents(v.discountedNet),
    vat: cents(v.vat),
  }));
  const allowanceSum = rates.reduce((s, r) => s + r.net - r.taxable, 0);
  const taxBasis = rates.reduce((s, r) => s + r.taxable, 0);
  const vatSum = rates.reduce((s, r) => s + r.vat, 0);
  const gross = cents(totals.gross);
  // BR-CO-10 (BT-106 = sum of BT-131), BR-CO-13 (BT-109 = BT-106 - BT-107), BR-CO-15 (BT-112 = BT-109 + BT-110).
  if (lineSum !== cents(totals.net)) mismatch("line nets");
  if (rates.reduce((s, r) => s + r.net, 0) !== lineSum) mismatch("vat breakdown nets");
  if (allowanceSum !== cents(totals.discount)) mismatch("discount");
  if (taxBasis + vatSum !== gross) mismatch("gross");
  if (data.lines.length === 0) throw new Error("einvoice_no_lines");

  // Same display name as the PDF header (sellerDisplayName in pdf/quoteDocument.tsx, not imported
  // here to keep this module free of react-pdf).
  const sellerName = [seller.company_name, seller.legal_form].filter(filled).join(" ");
  const sellerTax = [
    ...(filled(seller.vat_id) ? [{ "cbc:CompanyID": seller.vat_id, "cac:TaxScheme": { "cbc:ID": "VAT" } }] : []),
    ...(filled(seller.tax_number) ? [{ "cbc:CompanyID": seller.tax_number, "cac:TaxScheme": { "cbc:ID": "FC" } }] : []),
  ] as Ubl["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyTaxScheme"];
  const contact = {
    ...(filled(seller.phone) ? { "cbc:Telephone": seller.phone } : {}),
    ...(filled(seller.email) ? { "cbc:ElectronicMail": seller.email } : {}),
  };

  const allowances = rates
    .filter((r) => r.net !== r.taxable)
    .map((r) => ({
      "cbc:ChargeIndicator": "false",
      "cbc:AllowanceChargeReason": "Rabatt",
      "cbc:Amount": money(r.net - r.taxable),
      "cbc:Amount@currencyID": C,
      "cac:TaxCategory": vatCategory(r.rate),
    }));

  const ubl: Ubl = {
    "cbc:CustomizationID": "urn:cen.eu:en16931:2017",
    "cbc:ID": data.number,
    "cbc:IssueDate": data.issueDate,
    "cbc:DueDate": data.dueDate,
    "cbc:InvoiceTypeCode": data.type === "cancellation" ? "381" : "380",
    "cbc:DocumentCurrencyCode": C,
    ...(data.serviceTo ? { "cac:InvoicePeriod": { "cbc:StartDate": data.serviceFrom, "cbc:EndDate": data.serviceTo } } : {}),
    ...(data.precedingInvoice
      ? {
        "cac:BillingReference": [{
          "cac:InvoiceDocumentReference": { "cbc:ID": data.precedingInvoice.number, "cbc:IssueDate": data.precedingInvoice.issueDate },
        }],
      }
      : {}),
    "cac:AccountingSupplierParty": {
      "cac:Party": {
        ...(filled(seller.email) ? { "cbc:EndpointID": seller.email, "cbc:EndpointID@schemeID": "EM" } : {}),
        "cac:PartyName": { "cbc:Name": sellerName },
        "cac:PostalAddress": {
          "cbc:StreetName": seller.street,
          "cbc:CityName": seller.city,
          "cbc:PostalZone": seller.postal_code,
          "cac:Country": { "cbc:IdentificationCode": seller.country_code as Country },
        },
        "cac:PartyTaxScheme": sellerTax,
        "cac:PartyLegalEntity": {
          "cbc:RegistrationName": sellerName,
          ...(filled(seller.register_number) ? { "cbc:CompanyID": seller.register_number } : {}),
        },
        ...(Object.keys(contact).length > 0 ? { "cac:Contact": contact } : {}),
      },
    },
    "cac:AccountingCustomerParty": {
      "cac:Party": {
        ...(filled(buyer.invoice_email) ? { "cbc:EndpointID": buyer.invoice_email, "cbc:EndpointID@schemeID": "EM" } : {}),
        ...(filled(buyer.customer_no) ? { "cac:PartyIdentification": { "cbc:ID": buyer.customer_no } } : {}),
        "cac:PostalAddress": {
          "cbc:StreetName": buyer.street,
          "cbc:CityName": buyer.city,
          "cbc:PostalZone": buyer.postal_code,
          "cac:Country": { "cbc:IdentificationCode": buyer.country_code as Country },
        },
        ...(filled(buyer.vat_id) ? { "cac:PartyTaxScheme": { "cbc:CompanyID": buyer.vat_id, "cac:TaxScheme": { "cbc:ID": "VAT" } } } : {}),
        "cac:PartyLegalEntity": { "cbc:RegistrationName": buyer.name },
      },
    },
    // BT-72: the service date, or the end of the service period. Without it the library emits an
    // empty ApplicableHeaderTradeDelivery, which the Factur-X schematron flags (PEPPOL-EN16931-R008).
    "cac:Delivery": { "cbc:ActualDeliveryDate": data.serviceTo ?? data.serviceFrom },
    ...(filled(seller.iban)
      ? {
        "cac:PaymentMeans": [{
          "cbc:PaymentMeansCode": "58",
          "cac:PayeeFinancialAccount": {
            "cbc:ID": seller.iban.replace(/\s+/g, ""),
            ...(filled(seller.bic) ? { "cac:FinancialInstitutionBranch": { "cbc:ID": seller.bic.trim() } } : {}),
          },
        }],
      }
      : {}),
    ...(filled(data.paymentTerms) ? { "cac:PaymentTerms": { "cbc:Note": data.paymentTerms } } : {}),
    ...(allowances.length > 0 ? { "cac:AllowanceCharge": allowances } : {}),
    "cac:TaxTotal": [{
      "cbc:TaxAmount": money(vatSum),
      "cbc:TaxAmount@currencyID": C,
      "cac:TaxSubtotal": rates.map((r) => ({
        "cbc:TaxableAmount": money(r.taxable),
        "cbc:TaxableAmount@currencyID": C,
        "cbc:TaxAmount": money(r.vat),
        "cbc:TaxAmount@currencyID": C,
        "cac:TaxCategory": vatCategory(r.rate),
      })),
    }],
    "cac:LegalMonetaryTotal": {
      "cbc:LineExtensionAmount": money(lineSum),
      "cbc:LineExtensionAmount@currencyID": C,
      "cbc:TaxExclusiveAmount": money(taxBasis),
      "cbc:TaxExclusiveAmount@currencyID": C,
      "cbc:TaxInclusiveAmount": money(gross),
      "cbc:TaxInclusiveAmount@currencyID": C,
      ...(allowances.length > 0 ? { "cbc:AllowanceTotalAmount": money(allowanceSum), "cbc:AllowanceTotalAmount@currencyID": C } : {}),
      "cbc:PayableAmount": money(gross),
      "cbc:PayableAmount@currencyID": C,
    },
    "cac:InvoiceLine": data.lines.map((l, i) => ({
      "cbc:ID": String(i + 1),
      "cbc:InvoicedQuantity": qty(l.quantity),
      "cbc:InvoicedQuantity@unitCode": l.unitCode,
      "cbc:LineExtensionAmount": amt(l.lineNet),
      "cbc:LineExtensionAmount@currencyID": C,
      "cac:Item": {
        ...(filled(l.description) ? { "cbc:Description": l.description } : {}),
        "cbc:Name": l.name,
        "cac:ClassifiedTaxCategory": vatCategory(l.vatRate),
      },
      "cac:Price": { "cbc:PriceAmount": amt(l.unitPrice), "cbc:PriceAmount@currencyID": C },
    })) as Ubl["cac:InvoiceLine"],
  };
  return { "ubl:Invoice": ubl };
}
