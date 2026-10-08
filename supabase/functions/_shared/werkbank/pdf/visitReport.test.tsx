import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { SellerSnapshot } from "../einvoice/invoiceData.ts";
import { extractPdfText } from "../../hire-order-pdf/pdfText.ts";
import type { VisitReportPdfData } from "./visitReportData.ts";
import { renderVisitReportPdf } from "./visitReportDocument.tsx";

// A valid 1x1 PNG, standing in for a photo and a signature.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const seller = {
  company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331", city: "München",
  iban: "DE02120300000000202051", bic: null, bank_name: null,
} as unknown as SellerSnapshot;

const data: VisitReportPdfData = {
  seller,
  orderNumber: "AU-0042",
  subject: "Badsanierung",
  customer: "Anna Muster",
  location: ["Haus Eiche", "Eichenweg 3", "80333 München"],
  sections: [{ title: "Sanitär", number: "1", rows: [{ kind: "item", number: "1.1", name: "Ventil", quantity: 2, unit: "Stk" }] }],
  reports: [
    {
      id: "r1", visitDate: "2026-10-06", technician: "Ben Berg", body: "Ventil getauscht", draft: false, photos: [PNG, PNG, PNG],
      signature: { name: "Frau Meier", signedAt: "2026-10-06T22:30:00Z", imageDataUrl: PNG },
    },
    { id: "r2", visitDate: "2026-10-07", technician: "Ben Berg", body: "Nacharbeit", draft: true, photos: [], signature: null },
  ],
};

const text = async (d: VisitReportPdfData) => (await extractPdfText(await renderVisitReportPdf(d))).replace(/\s+/g, " ");

Deno.test("renders the visit reports without any price", async () => {
  const bytes = await renderVisitReportPdf(data);
  assertEquals(new TextDecoder("latin1").decode(bytes.slice(0, 4)), "%PDF");
  const t = await text(data);
  assertStringIncludes(t, "Einsatzbericht");
  assertStringIncludes(t, "AU-0042");
  assertStringIncludes(t, "Anna Muster");
  assertStringIncludes(t, "Eichenweg 3");
  assertStringIncludes(t, "Ventil");
  assertStringIncludes(t, "Ben Berg");
  assertStringIncludes(t, "06.10.2026");
  assertStringIncludes(t, "Ventil getauscht");
  // Signed at 22:30 UTC is the next day in Berlin.
  assertStringIncludes(t, "Unterschrieben von Frau Meier am 07.10.2026");
  assertStringIncludes(t, "Nicht unterschrieben");
  assertStringIncludes(t, "Entwurf");
  assertStringIncludes(t, "Muster Sanitär");
  assert(!t.includes("€"), "no prices");
  assert(!t.includes("Einzelpreis"));
});

Deno.test("no draft marker when every report is locked", async () => {
  const t = await text({ ...data, reports: [data.reports[0]] });
  assert(!t.includes("Entwurf"));
  assert(!t.includes("Nicht unterschrieben"));
});
