import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { MAX_SIGNATURE_PNG_CHARS, parseSignature, QUOTE_CONSENT_TEXT, quoteConsentText } from "./acceptance.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pngUrl = (bytes: Uint8Array) => `data:image/png;base64,${encodeBase64(bytes)}`;

Deno.test("a typed signature of 2 to 120 characters is accepted and trimmed", () => {
  assertEquals(parseSignature({ method: "typed", typedName: "  Anna Muster " }), { method: "typed", typedName: "Anna Muster" });
  assertEquals(parseSignature({ method: "typed", typedName: "AM" }), { method: "typed", typedName: "AM" });
  assertEquals(parseSignature({ method: "typed", typedName: "x".repeat(120) })?.method, "typed");
});

Deno.test("a typed name shorter than 2 or longer than 120 characters is rejected", () => {
  assertEquals(parseSignature({ method: "typed", typedName: " A " }), null);
  assertEquals(parseSignature({ method: "typed", typedName: "x".repeat(121) }), null);
  assertEquals(parseSignature({ method: "typed", typedName: 42 }), null);
});

Deno.test("a drawn PNG data URL is decoded to its bytes", () => {
  const sig = parseSignature({ method: "drawn", pngDataUrl: pngUrl(PNG) });
  assert(sig && sig.method === "drawn");
  assertEquals(sig.png, PNG);
});

Deno.test("a drawn signature that is not a PNG is rejected", () => {
  assertEquals(parseSignature({ method: "drawn", pngDataUrl: pngUrl(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])) }), null);
  assertEquals(parseSignature({ method: "drawn", pngDataUrl: `data:image/jpeg;base64,${encodeBase64(PNG)}` }), null);
  assertEquals(parseSignature({ method: "drawn", pngDataUrl: "data:image/png;base64,%%%" }), null);
});

Deno.test("a drawn signature over the size cap is rejected", () => {
  const big = pngUrl(PNG) + "A".repeat(MAX_SIGNATURE_PNG_CHARS);
  assertEquals(parseSignature({ method: "drawn", pngDataUrl: big }), null);
  assertEquals(MAX_SIGNATURE_PNG_CHARS, 2_000_000);
});

Deno.test("anything else is rejected", () => {
  for (const v of [null, undefined, "Anna", [], {}, { method: "stamp" }, { method: "drawn" }]) {
    assertEquals(parseSignature(v), null);
  }
});

Deno.test("the consent text names the quote, is German and has no dashes", () => {
  const text = quoteConsentText("A-0042-2");
  assert(text.includes("A-0042-2"));
  assert(QUOTE_CONSENT_TEXT.includes("{quote_no}"));
  assert(!/[–—]/.test(text));
  assert(!/\b(du|dich|dein)\b/i.test(text));
});

Deno.test("the consent text does not claim the written form of a handwritten signature", () => {
  // An e-signature on a web page is not §126/§126a BGB written form; the text must not say so.
  const text = quoteConsentText("A-0042");
  assert(!/eigenhändig|handschriftlich/i.test(text));
  assert(text.includes("einschließlich der darin genannten Bedingungen"));
  assert(text.includes("elektronisch"));
});
