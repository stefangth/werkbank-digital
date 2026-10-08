/** @jsxImportSource npm:react@18.3.1 */
// The Werkbank invoice PDF (§14 UStG content). Same layout pieces as the quote PDF; all copy is
// German and addressed with "Sie".
import { Document, Page, renderToBuffer, Text, View } from "npm:@react-pdf/renderer@^4";
import { registerQuoteFonts } from "../pdf/fonts.ts";
import { formatDateDe, type QuotePdfData } from "../pdf/quoteData.ts";
import { ItemRow, Line, money, PageFooter, pct, s, SellerHeader, sellerAddressLine, sellerDisplayName } from "../pdf/quoteDocument.tsx";
import type { InvoiceData } from "./invoiceData.ts";

const orUndef = (v: string | null): string | undefined => (v?.trim() ? v : undefined);

// A cancellation reverses the original: its totals print negative. Display only, the stored
// amounts and the XML stay positive (R19).
const signed = (n: number, negative: boolean) => (negative && n !== 0 ? -n : n);

function pdfSeller(d: InvoiceData, logoDataUrl?: string): QuotePdfData["seller"] {
  const x = d.seller;
  return {
    companyName: x.company_name, legalForm: orUndef(x.legal_form), street: x.street, postalCode: x.postal_code, city: x.city,
    phone: orUndef(x.phone), email: orUndef(x.email), website: orUndef(x.website),
    registerCourt: orUndef(x.register_court), registerNumber: orUndef(x.register_number),
    taxNumber: orUndef(x.tax_number), vatId: orUndef(x.vat_id),
    bankName: orUndef(x.bank_name), iban: orUndef(x.iban), bic: orUndef(x.bic), logoDataUrl,
  };
}

export function InvoiceDocument({ data, logoDataUrl }: { data: InvoiceData; logoDataUrl?: string }) {
  const { buyer, totals } = data;
  const seller = pdfSeller(data, logoDataUrl);
  const isCancellation = data.type === "cancellation";
  const title = isCancellation ? `Stornorechnung ${data.number}` : `Rechnung ${data.number}`;
  const prop = buyer.property;
  const propLines = prop
    ? [prop.name, prop.street, [prop.postal_code, prop.city].filter(Boolean).join(" ")].filter((l): l is string => !!l?.trim())
    : [];
  return (
    <Document title={title} author={seller.companyName}>
      <Page size="A4" style={s.page}>
        {data.watermark ? <Text style={s.watermark} fixed>{data.watermark}</Text> : null}
        <SellerHeader seller={seller} />

        <View style={s.addressRow}>
          <View style={s.recipient}>
            <Text style={s.senderLine}>{`${sellerDisplayName(seller)} · ${sellerAddressLine(seller)}`}</Text>
            <Text>{buyer.name}</Text>
            <Text>{buyer.street}</Text>
            <Text>{`${buyer.postal_code} ${buyer.city}`}</Text>
            {buyer.vat_id ? <Text>{`USt-IdNr. ${buyer.vat_id}`}</Text> : null}
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}><Text style={s.metaLabel}>{isCancellation ? "Stornonummer" : "Rechnungsnummer"}</Text><Text>{data.number}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Rechnungsdatum</Text><Text>{formatDateDe(data.issueDate)}</Text></View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>{data.serviceTo ? "Leistungszeitraum" : "Leistungsdatum"}</Text>
              <Text>{data.serviceTo ? `${formatDateDe(data.serviceFrom)} bis ${formatDateDe(data.serviceTo)}` : formatDateDe(data.serviceFrom)}</Text>
            </View>
            {isCancellation ? null : (
              <View style={s.metaRow}><Text style={s.metaLabel}>Fällig am</Text><Text>{formatDateDe(data.dueDate)}</Text></View>
            )}
            {buyer.customer_no ? <View style={s.metaRow}><Text style={s.metaLabel}>Kundennummer</Text><Text>{buyer.customer_no}</Text></View> : null}
            {propLines.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={s.metaLabel}>Ausführungsort</Text>
                {propLines.map((l, i) => <Text key={i}>{l}</Text>)}
              </View>
            ) : null}
          </View>
        </View>

        <Text style={s.title}>{title}</Text>
        {isCancellation && data.precedingInvoice ? (
          <Text style={s.subject}>{`zu Rechnung ${data.precedingInvoice.number} vom ${formatDateDe(data.precedingInvoice.issueDate)}`}</Text>
        ) : null}
        {data.subject ? <Text style={s.subject}>{data.subject}</Text> : null}
        {data.intro ? <Text style={s.paragraph}>{data.intro}</Text> : null}

        <View style={s.tableHead} fixed>
          <Text style={s.cNo}>Pos.</Text>
          <Text style={s.cName}>Bezeichnung</Text>
          <Text style={s.cQty}>Menge</Text>
          <Text style={s.cUnit}>Einheit</Text>
          <Text style={s.cPrice}>Einzelpreis</Text>
          <Text style={s.cTotal}>Gesamt netto</Text>
        </View>
        {data.sections.map((sec, i) => (
          <View key={i}>
            {sec.title !== undefined ? (
              <View style={s.sectionTitle} wrap={false} minPresenceAhead={40}>
                <Text style={s.cNo}>{sec.number}</Text>
                <Text>{sec.title}</Text>
              </View>
            ) : null}
            {sec.rows.map((r, j) => <ItemRow key={j} row={r} />)}
            {sec.subtotal !== undefined ? (
              <View style={s.subtotal} wrap={false}>
                <Text>{`Zwischensumme ${sec.number}: ${money(sec.subtotal)}`}</Text>
              </View>
            ) : null}
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <Line label="Summe netto" value={money(signed(totals.net, isCancellation))} />
          {totals.discountPercent > 0 ? (
            <Line label={`Rabatt ${pct.format(totals.discountPercent)} %`} value={money(signed(totals.discount, !isCancellation))} />
          ) : null}
          {totals.vat.map((v) => (
            <Line
              key={v.rate}
              label={`Umsatzsteuer ${pct.format(v.rate)} % auf ${money(signed(v.discountedNet, isCancellation))}`}
              value={money(signed(v.vat, isCancellation))}
            />
          ))}
          <Line label="Gesamtbetrag brutto" value={money(signed(totals.gross, isCancellation))} style={s.grossRow} />
          {totals.labour !== null ? (
            <Line label="davon Lohnanteil (§35a EStG)" value={money(signed(totals.labour, isCancellation))} />
          ) : null}
        </View>

        <View style={{ marginTop: 18 }} wrap={false}>
          {isCancellation ? (
            <Text style={s.paragraph}>
              {data.precedingInvoice
                ? `Diese Stornorechnung hebt die Rechnung ${data.precedingInvoice.number} vom ${formatDateDe(data.precedingInvoice.issueDate)} vollständig auf.`
                : "Diese Stornorechnung hebt die ursprüngliche Rechnung vollständig auf."}
            </Text>
          ) : (
            <Text style={s.paragraph}>
              {`Bitte überweisen Sie den Betrag bis zum ${formatDateDe(data.dueDate)}`}
              {seller.iban ? ` auf IBAN ${seller.iban}${seller.bic ? `, BIC ${seller.bic}` : ""}` : ""}
              {`. Bitte geben Sie die Rechnungsnummer ${data.number} an.`}
            </Text>
          )}
        </View>
        {/* Payment terms would read as a second bill on a cancellation. */}
        {data.paymentTerms && !isCancellation ? <Text style={s.paragraph}>{data.paymentTerms}</Text> : null}
        {data.closing ? <Text style={s.paragraph}>{data.closing}</Text> : null}

        <PageFooter seller={seller} />
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoiceData, logoDataUrl?: string): Promise<Uint8Array> {
  await registerQuoteFonts();
  const buffer = await renderToBuffer(<InvoiceDocument data={data} logoDataUrl={logoDataUrl} />);
  return new Uint8Array(buffer);
}
