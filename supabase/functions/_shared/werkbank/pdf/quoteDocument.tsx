/** @jsxImportSource npm:react@18.3.1 */
// The Werkbank quote PDF. The only PDF code of the module: react-pdf from npm, Geist from
// ./fonts.ts. All copy is German and addressed with "Sie".
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "npm:@react-pdf/renderer@^4";
import { registerQuoteFonts } from "./fonts.ts";
import { formatDateDe, type QuotePdfData, type QuotePdfRow } from "./quoteData.ts";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const qty = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

const INK = "#1a1a1a";
const MUTED = "#666666";
const RULE = "#cccccc";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9.5, color: INK, paddingTop: 48, paddingBottom: 96, paddingHorizontal: 50, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logo: { maxWidth: 150, maxHeight: 56, objectFit: "contain" },
  sellerBlock: { textAlign: "right", color: MUTED, fontSize: 8.5 },
  sellerName: { fontWeight: 600, color: INK, fontSize: 11 },
  senderLine: { fontSize: 7, color: MUTED, borderBottomWidth: 0.5, borderBottomColor: RULE, paddingBottom: 2, marginBottom: 4 },
  addressRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  recipient: { width: "55%" },
  meta: { width: "40%" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  metaLabel: { color: MUTED },
  title: { fontSize: 15, fontWeight: 600, marginBottom: 4 },
  subject: { fontSize: 11, fontWeight: 600, marginBottom: 8 },
  paragraph: { marginBottom: 10 },
  sectionTitle: { flexDirection: "row", fontWeight: 600, fontSize: 10.5, marginTop: 12, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 0.5, borderBottomColor: INK },
  tableHead: { flexDirection: "row", color: MUTED, fontSize: 8, paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: RULE },
  row: { flexDirection: "row", paddingVertical: 3 },
  cNo: { width: 30 },
  cName: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
  cQty: { width: 58, textAlign: "right" },
  cUnit: { width: 40, paddingLeft: 4 },
  cPrice: { width: 62, textAlign: "right" },
  cTotal: { width: 66, textAlign: "right" },
  desc: { color: MUTED, fontSize: 8.5 },
  textRow: { paddingVertical: 3, paddingLeft: 30, color: MUTED },
  subtotal: { flexDirection: "row", justifyContent: "flex-end", paddingTop: 3, fontWeight: 500 },
  totals: { marginTop: 16, alignSelf: "flex-end", width: 250 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grossRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, marginTop: 3, borderTopWidth: 0.8, borderTopColor: INK, fontWeight: 600, fontSize: 11 },
  note: { fontSize: 8, color: MUTED, marginTop: 4 },
  signature: { marginTop: 18, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: RULE },
  signatureImage: { width: 140, height: 50, objectFit: "contain", marginTop: 4 },
  footer: { position: "absolute", left: 50, right: 50, bottom: 28, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
  footerCol: { width: "32%" },
  pageNumber: { position: "absolute", right: 50, bottom: 14, fontSize: 7.5, color: MUTED },
  watermark: { position: "absolute", top: 330, left: 70, fontSize: 110, fontWeight: 600, color: "#e6e6e6", transform: "rotate(-30deg)" },
});

const money = (n: number) => eur.format(n);

function Line({ label, value, style }: { label: string; value: string; style?: typeof s.totalRow }) {
  return (
    <View style={style ?? s.totalRow}>
      <Text>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function ItemRow({ row }: { row: QuotePdfRow }) {
  if (row.kind === "text") {
    return (
      <View style={s.textRow} wrap={false}>
        {row.name ? <Text>{row.name}</Text> : null}
        {row.description ? <Text style={s.desc}>{row.description}</Text> : null}
      </View>
    );
  }
  return (
    <View style={s.row} wrap={false}>
      <Text style={s.cNo}>{row.number}</Text>
      <View style={s.cName}>
        <Text>{row.name}</Text>
        {row.description ? <Text style={s.desc}>{row.description}</Text> : null}
      </View>
      <Text style={s.cQty}>{qty.format(row.quantity ?? 0)}</Text>
      <Text style={s.cUnit}>{row.unit ?? ""}</Text>
      <Text style={s.cPrice}>{money(row.unitPrice ?? 0)}</Text>
      <Text style={s.cTotal}>{money(row.lineNet ?? 0)}</Text>
    </View>
  );
}

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const { seller, totals } = data;
  const sellerAddress = `${seller.street}, ${seller.postalCode} ${seller.city}`;
  const sellerName = [seller.companyName, seller.legalForm].filter(Boolean).join(" ");
  return (
    <Document title={`Angebot ${data.number}`} author={seller.companyName}>
      <Page size="A4" style={s.page}>
        {data.watermark ? <Text style={s.watermark} fixed>{data.watermark}</Text> : null}

        <View style={s.header}>
          <View>{seller.logoDataUrl ? <Image src={seller.logoDataUrl} style={s.logo} /> : <Text style={s.sellerName}>{sellerName}</Text>}</View>
          <View style={s.sellerBlock}>
            <Text style={s.sellerName}>{sellerName}</Text>
            <Text>{seller.street}</Text>
            <Text>{`${seller.postalCode} ${seller.city}`}</Text>
            {seller.phone ? <Text>{`Telefon ${seller.phone}`}</Text> : null}
            {seller.email ? <Text>{seller.email}</Text> : null}
          </View>
        </View>

        <View style={s.addressRow}>
          <View style={s.recipient}>
            <Text style={s.senderLine}>{`${sellerName} · ${sellerAddress}`}</Text>
            {data.recipient.lines.map((l, i) => <Text key={i}>{l}</Text>)}
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}><Text style={s.metaLabel}>Angebotsnummer</Text><Text>{data.number}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Datum</Text><Text>{data.date}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Gültig bis</Text><Text>{data.validUntil}</Text></View>
            {data.location.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={s.metaLabel}>Ausführungsort</Text>
                {data.location.map((l, i) => <Text key={i}>{l}</Text>)}
              </View>
            ) : null}
          </View>
        </View>

        <Text style={s.title}>Angebot</Text>
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
          <Line label="Summe netto" value={money(totals.net)} />
          {totals.discountPercent > 0 ? (
            <Line label={`Rabatt ${pct.format(totals.discountPercent)} %`} value={`-${money(totals.discount)}`} />
          ) : null}
          {totals.vat.map((v) => (
            <Line key={v.rate} label={`Umsatzsteuer ${pct.format(v.rate)} % auf ${money(v.net)}`} value={money(v.vat)} />
          ))}
          <Line label="Gesamtbetrag brutto" value={money(totals.gross)} style={s.grossRow} />
          {totals.discountPercent > 0 ? <Text style={s.note}>Rabatt auf die Gesamtsumme</Text> : null}
          {totals.labour !== undefined ? (
            <Text style={s.note}>{`Darin enthaltene Arbeitskosten (netto, ohne Material): ${money(totals.labour)}. Für Handwerkerleistungen können Sie die Steuerermäßigung nach § 35a EStG nutzen.`}</Text>
          ) : null}
        </View>

        {data.closing ? <Text style={{ ...s.paragraph, marginTop: 18 }}>{data.closing}</Text> : null}
        {data.paymentTerms ? <Text style={s.paragraph}>{data.paymentTerms}</Text> : null}

        {data.acceptance ? (
          <View style={s.signature} wrap={false}>
            <Text style={{ fontWeight: 600 }}>Angenommen</Text>
            <Text>{`${data.acceptance.name}, ${formatDateDe(data.acceptance.decidedAt)}`}</Text>
            {data.acceptance.signaturePngDataUrl ? (
              <Image src={data.acceptance.signaturePngDataUrl} style={s.signatureImage} />
            ) : data.acceptance.typedName ? (
              <Text style={{ marginTop: 4, fontSize: 13 }}>{data.acceptance.typedName}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <View style={s.footerCol}>
            <Text>{sellerName}</Text>
            <Text>{sellerAddress}</Text>
            {seller.website ? <Text>{seller.website}</Text> : null}
          </View>
          <View style={s.footerCol}>
            {seller.registerCourt || seller.registerNumber ? (
              <Text>{`Handelsregister ${[seller.registerCourt, seller.registerNumber].filter(Boolean).join(" ")}`}</Text>
            ) : null}
            {seller.taxNumber ? <Text>{`Steuernummer ${seller.taxNumber}`}</Text> : null}
            {seller.vatId ? <Text>{`USt-IdNr. ${seller.vatId}`}</Text> : null}
          </View>
          <View style={s.footerCol}>
            {seller.bankName ? <Text>{seller.bankName}</Text> : null}
            {seller.iban ? <Text>{`IBAN ${seller.iban}`}</Text> : null}
            {seller.bic ? <Text>{`BIC ${seller.bic}`}</Text> : null}
          </View>
        </View>
        <Text style={s.pageNumber} fixed render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  await registerQuoteFonts();
  const buffer = await renderToBuffer(<QuoteDocument data={data} />);
  return new Uint8Array(buffer);
}
