/** @jsxImportSource npm:react@18.3.1 */
// The Werkbank visit report PDF (Teil 6a, R7): the letterhead of the quote and invoice, the order
// header, the order's items with quantity and unit only, then one block per visit report with its
// text, photos in two columns and the signature. Never a price. German, addressed with "Sie".
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "npm:@react-pdf/renderer@^4";
import { pdfSeller } from "../einvoice/invoiceDocument.tsx";
import { registerQuoteFonts } from "./fonts.ts";
import { formatDateDe } from "./quoteData.ts";
import { PageFooter, qty, s, SellerHeader } from "./quoteDocument.tsx";
import type { VisitReportItemRow, VisitReportPdfData, VisitReportPdfReport } from "./visitReportData.ts";

const v = StyleSheet.create({
  report: { marginTop: 18, paddingTop: 8, borderTopWidth: 0.8, borderTopColor: "#1a1a1a" },
  reportHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  reportTitle: { fontWeight: 600, fontSize: 10.5 },
  draft: { fontWeight: 600, fontSize: 8, color: "#8a5a00", borderWidth: 0.8, borderColor: "#8a5a00", paddingHorizontal: 4, paddingVertical: 1 },
  photos: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 4 },
  photo: { width: "49%", height: 180, objectFit: "contain", marginBottom: 8 },
});

const berlin = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** An ISO timestamp as "07.10.2026 um 00:30 Uhr", Berlin time. */
function formatTimestampDe(iso: string): string {
  const parts = Object.fromEntries(berlin.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day}.${parts.month}.${parts.year} um ${parts.hour}:${parts.minute} Uhr`;
}

function ItemLine({ row }: { row: VisitReportItemRow }) {
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
    </View>
  );
}

function Report({ report }: { report: VisitReportPdfReport }) {
  return (
    <View style={v.report}>
      <View style={v.reportHead} wrap={false} minPresenceAhead={60}>
        <Text style={v.reportTitle}>{`Einsatz am ${formatDateDe(report.visitDate)}, ${report.technician}`}</Text>
        {report.draft ? <Text style={v.draft}>Entwurf</Text> : null}
      </View>
      {report.body.trim() ? <Text style={s.paragraph}>{report.body}</Text> : null}
      {report.photos.length > 0 ? (
        <View style={v.photos}>
          {report.photos.map((src, i) => <Image key={i} src={src} style={v.photo} />)}
        </View>
      ) : null}
      {report.morePhotos ? <Text style={s.desc}>Weitere Fotos sind in Werkbank gespeichert.</Text> : null}
      <View style={s.signature} wrap={false}>
        {report.signature ? (
          <>
            <Text>{`Unterschrieben von ${report.signature.name} am ${formatTimestampDe(report.signature.signedAt)}`}</Text>
            {report.signature.imageDataUrl ? <Image src={report.signature.imageDataUrl} style={s.signatureImage} /> : null}
          </>
        ) : (
          <Text style={s.metaLabel}>Nicht unterschrieben</Text>
        )}
      </View>
    </View>
  );
}

export function VisitReportDocument({ data }: { data: VisitReportPdfData }) {
  const seller = pdfSeller(data.seller, data.logoDataUrl);
  const hasItems = data.sections.some((sec) => sec.rows.length > 0 || sec.title !== undefined);
  return (
    <Document title={`Einsatzbericht ${data.orderNumber}`} author={seller.companyName}>
      <Page size="A4" style={s.page}>
        <SellerHeader seller={seller} />

        <View style={s.addressRow}>
          <View style={s.recipient}>
            <Text style={s.metaLabel}>Kunde</Text>
            <Text>{data.customer}</Text>
            {data.location.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={s.metaLabel}>Ausführungsort</Text>
                {data.location.map((l, i) => <Text key={i}>{l}</Text>)}
              </View>
            ) : null}
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}><Text style={s.metaLabel}>Auftragsnummer</Text><Text>{data.orderNumber}</Text></View>
          </View>
        </View>

        <Text style={s.title}>Einsatzbericht</Text>
        {data.subject ? <Text style={s.subject}>{data.subject}</Text> : null}

        {hasItems ? (
          <View>
            <View style={s.tableHead}>
              <Text style={s.cNo}>Pos.</Text>
              <Text style={s.cName}>Bezeichnung</Text>
              <Text style={s.cQty}>Menge</Text>
              <Text style={s.cUnit}>Einheit</Text>
            </View>
            {data.sections.map((sec, i) => (
              <View key={i}>
                {sec.title !== undefined ? (
                  <View style={s.sectionTitle} wrap={false} minPresenceAhead={40}>
                    <Text style={s.cNo}>{sec.number}</Text>
                    <Text>{sec.title}</Text>
                  </View>
                ) : null}
                {sec.rows.map((r, j) => <ItemLine key={j} row={r} />)}
              </View>
            ))}
          </View>
        ) : null}

        {data.reports.map((r) => <Report key={r.id} report={r} />)}

        <PageFooter seller={seller} />
      </Page>
    </Document>
  );
}

export async function renderVisitReportPdf(data: VisitReportPdfData): Promise<Uint8Array> {
  await registerQuoteFonts();
  const buffer = await renderToBuffer(<VisitReportDocument data={data} />);
  return new Uint8Array(buffer);
}
