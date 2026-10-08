// The one invoice file: the visual PDF with factur-x.xml embedded (Factur-X EN 16931, PDF/A-3).
// esm.sh's single-file build instead of npm:, so the edge bundle carries only the code that runs
// (the npm package ships every build, source maps and an Excel library: the eszip exceeded the
// upload limit). Version pinned; the Mustang CI job validates the output on every change.
// @deno-types="https://esm.sh/@e-invoice-eu/core@3.4.0/dist/index.d.ts"
import { InvoiceService } from "https://esm.sh/@e-invoice-eu/core@3.4.0?bundle&target=deno";
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
