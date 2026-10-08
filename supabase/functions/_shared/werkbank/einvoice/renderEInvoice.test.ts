import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { cancellationInvoice, discountInvoice } from "./fixtures.ts";
import { renderEInvoice } from "./renderEInvoice.ts";

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

async function inflate(bytes: Uint8Array): Promise<string | null> {
  try {
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Every stream body of the PDF, inflated when Flate-compressed (test support, not a PDF parser). */
async function streams(pdf: Uint8Array): Promise<string[]> {
  const doc = latin1(pdf);
  const out: string[] = [];
  for (const m of doc.matchAll(/\/Length (\d+)[^]*?>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const raw = pdf.subarray(start, start + Number(m[1]));
    out.push((await inflate(raw)) ?? latin1(raw));
  }
  return out;
}

async function embeddedXml(pdf: Uint8Array): Promise<string> {
  const xml = (await streams(pdf)).find((s) => s.includes("rsm:CrossIndustryInvoice"));
  assert(xml, "no CII XML stream in the PDF");
  return xml;
}

Deno.test("renders a Factur-X PDF with factur-x.xml in the EN 16931 profile", async () => {
  const pdf = await renderEInvoice(discountInvoice());
  assertEquals(latin1(pdf.subarray(0, 4)), "%PDF");
  const doc = latin1(pdf);
  assertStringIncludes(doc, "factur-x.xml");
  const xml = await embeddedXml(pdf);
  assertStringIncludes(xml, "urn:cen.eu:en16931:2017");
  assertStringIncludes(xml, "<ram:TaxBasisTotalAmount>37.37</ram:TaxBasisTotalAmount>");
  assertStringIncludes(xml, "<ram:GrandTotalAmount>40.11</ram:GrandTotalAmount>");
});

Deno.test("a cancellation embeds type code 381 and the preceding invoice", async () => {
  const xml = await embeddedXml(await renderEInvoice(cancellationInvoice()));
  assertStringIncludes(xml, "<ram:TypeCode>381</ram:TypeCode>");
  assertStringIncludes(xml, "RE-0001");
});
