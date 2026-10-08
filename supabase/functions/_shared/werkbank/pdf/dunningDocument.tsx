/** @jsxImportSource npm:react@18.3.1 */
// The Werkbank dunning notice PDF: letterhead, fonts and footer of the invoice document. German,
// addressed with "Sie".
import { Document, Page, renderToBuffer, Text, View } from "npm:@react-pdf/renderer@^4";
import { pdfSeller } from "../einvoice/invoiceDocument.tsx";
import { DUNNING_STAGE_TITLES } from "../dunningDefaults.ts";
import { registerQuoteFonts } from "./fonts.ts";
import type { DunningData } from "./dunningData.ts";
import { formatDateDe } from "./quoteData.ts";
import { money, PageFooter, s, SellerHeader, sellerAddressLine, sellerDisplayName } from "./quoteDocument.tsx";

export function DunningDocument({ data, logoDataUrl }: { data: DunningData; logoDataUrl?: string }) {
  const { buyer, invoice } = data;
  const seller = pdfSeller(data.seller, logoDataUrl);
  const reference = `Rechnung ${invoice.no} vom ${formatDateDe(invoice.issueDate)}${invoice.propertyName ? `, Liegenschaft ${invoice.propertyName}` : ""}`;
  const earlier = data.earlierNotices.map((e) => `${DUNNING_STAGE_TITLES[e.stage]} vom ${formatDateDe(e.date)}`);
  const earlierSentence = earlier.length
    ? `Unsere ${earlier.join(" und unsere ")} ${earlier.length === 1 ? "blieb" : "blieben"} bisher ohne vollständige Zahlung.`
    : null;
  return (
    <Document title={`${data.title} ${invoice.no}`} author={seller.companyName}>
      <Page size="A4" style={s.page}>
        {data.draft ? <Text style={s.watermark} fixed>ENTWURF</Text> : null}
        <SellerHeader seller={seller} />

        <View style={s.addressRow}>
          <View style={s.recipient}>
            <Text style={s.senderLine}>{`${sellerDisplayName(seller)} · ${sellerAddressLine(seller)}`}</Text>
            <Text>{buyer.name}</Text>
            <Text>{buyer.street}</Text>
            <Text>{`${buyer.postal_code} ${buyer.city}`}</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}><Text style={s.metaLabel}>Datum</Text><Text>{formatDateDe(data.noticeDate)}</Text></View>
            {buyer.customer_no ? <View style={s.metaRow}><Text style={s.metaLabel}>Kundennummer</Text><Text>{buyer.customer_no}</Text></View> : null}
          </View>
        </View>

        <Text style={s.title}>{data.title}</Text>
        <Text style={s.subject}>{reference}</Text>
        <Text style={s.paragraph}>Sehr geehrte Damen und Herren,</Text>
        <Text style={s.paragraph}>{data.text}</Text>

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text>Rechnungsbetrag</Text><Text>{money(data.invoiceGross)}</Text></View>
          <View style={s.totalRow}><Text>Bereits gezahlt</Text><Text>{money(data.paidAmount)}</Text></View>
          {data.writtenOff !== 0 && (
            <View style={s.totalRow}><Text>Ausgebucht</Text><Text>{money(data.writtenOff)}</Text></View>
          )}
          <View style={s.grossRow}><Text>Offener Betrag</Text><Text>{money(data.openAmount)}</Text></View>
          <View style={s.totalRow}><Text>Ursprünglich fällig am</Text><Text>{formatDateDe(invoice.dueDate)}</Text></View>
        </View>

        <View style={{ marginTop: 18 }} wrap={false}>
          <Text style={s.paragraph}>
            {`Bitte überweisen Sie den offenen Betrag von ${money(data.openAmount)} bis zum ${formatDateDe(data.paymentDeadline)} auf das unten genannte Konto.`}
          </Text>
          {earlierSentence ? <Text style={s.paragraph}>{earlierSentence}</Text> : null}
          <Text style={s.paragraph}>Mit freundlichen Grüßen</Text>
          <Text>{sellerDisplayName(seller)}</Text>
        </View>

        <PageFooter seller={seller} />
      </Page>
    </Document>
  );
}

export async function renderDunningPdf(data: DunningData, logoDataUrl?: string): Promise<Uint8Array> {
  await registerQuoteFonts();
  const buffer = await renderToBuffer(<DunningDocument data={data} logoDataUrl={logoDataUrl} />);
  return new Uint8Array(buffer);
}
