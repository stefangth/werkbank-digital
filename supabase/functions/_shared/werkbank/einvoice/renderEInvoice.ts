// The one invoice file: the visual PDF with factur-x.xml embedded (Factur-X EN 16931, PDF/A-3).
import { InvoiceService } from "npm:@e-invoice-eu/core@3.4.0";
import { toUblInput } from "./facturx.ts";
import type { InvoiceData } from "./invoiceData.ts";
import { renderInvoicePdf } from "./invoiceDocument.tsx";

export async function renderEInvoice(data: InvoiceData, logoDataUrl?: string): Promise<Uint8Array> {
  const ubl = toUblInput(data);
  const buffer = await renderInvoicePdf(data, logoDataUrl);
  const out = await new InvoiceService(console).generate(ubl, {
    format: "Factur-X-EN16931",
    lang: "de-de",
    pdf: { buffer, filename: `${data.number || "rechnung"}.pdf`, mimetype: "application/pdf" },
  });
  if (!(out instanceof Uint8Array)) throw new Error("einvoice_unexpected_output");
  return out;
}
