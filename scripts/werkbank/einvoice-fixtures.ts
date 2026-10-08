#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/**
 * Renders the four e-invoice fixtures through the real pipeline (renderEInvoice)
 * and writes <name>.pdf into the directory given as the first argument. CI feeds
 * the files to the Mustang validator (.github/workflows/einvoice-validate.yml).
 */
import {
  cancellationInvoice,
  discountInvoice,
  mixedRatesInvoice,
  plainInvoice,
} from "../../supabase/functions/_shared/werkbank/einvoice/fixtures.ts";
import { renderEInvoice } from "../../supabase/functions/_shared/werkbank/einvoice/renderEInvoice.ts";

const dir = Deno.args[0];
if (!dir) {
  console.error("usage: einvoice-fixtures.ts <output-dir>");
  Deno.exit(2);
}
await Deno.mkdir(dir, { recursive: true });

const fixtures = {
  plain: plainInvoice,
  discount: discountInvoice,
  mixed: mixedRatesInvoice,
  cancellation: cancellationInvoice,
};
for (const [name, build] of Object.entries(fixtures)) {
  const path = `${dir}/${name}.pdf`;
  await Deno.writeFile(path, await renderEInvoice(build()));
  console.log(`wrote ${path}`);
}
