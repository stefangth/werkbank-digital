// Online acceptance of a quote: the signature payload and the consent text (spec R6).
// The validation follows the hire-order sign action (typed name, or a PNG data URL with the
// 8-byte PNG signature and a size cap); it is copied here because the module must not import
// a Showflow function.
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

/** About 1.5 MB decoded: a generous cap for a canvas PNG. Counted on the data URL. */
export const MAX_SIGNATURE_PNG_CHARS = 2_000_000;
const PNG_PREFIX = "data:image/png;base64,";
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MIN_NAME = 2;
const MAX_NAME = 120;

export type ParsedSignature = { method: "typed"; typedName: string } | { method: "drawn"; png: Uint8Array };

/** A trimmed name of 2 to 120 characters, else null. */
export function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= MIN_NAME && t.length <= MAX_NAME ? t : null;
}

/** The PNG bytes of a data URL, or null when it does not decode or is not a PNG. */
function decodePngOrNull(dataUrl: string): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(dataUrl.slice(dataUrl.indexOf(",") + 1));
  } catch {
    return null;
  }
  if (bytes.length < 8 || PNG_SIG.some((b, i) => bytes[i] !== b)) return null;
  return bytes;
}

/**
 * The signature the public page sends, in the shape of `SignatureValue` from the shared
 * SignaturePad: `{ method: "typed", typedName }` or `{ method: "drawn", pngDataUrl }`.
 * Returns null for anything invalid.
 */
export function parseSignature(input: unknown): ParsedSignature | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (o.method === "typed") {
    const typedName = parseName(o.typedName);
    return typedName ? { method: "typed", typedName } : null;
  }
  if (o.method === "drawn") {
    const url = o.pngDataUrl;
    if (typeof url !== "string" || !url.startsWith(PNG_PREFIX) || url.length > MAX_SIGNATURE_PNG_CHARS) return null;
    const png = decodePngOrNull(url);
    return png ? { method: "drawn", png } : null;
  }
  return null;
}

/**
 * The consent the signer confirms on the public page, shown there verbatim (the `view`
 * response) and stored with the acceptance. `{quote_no}` is the quote number with its
 * version suffix, so the text names the exact version that was shown.
 */
export const QUOTE_CONSENT_TEXT =
  "Ich nehme das Angebot {quote_no} in der hier angezeigten Fassung einschließlich der darin genannten Bedingungen verbindlich an und bestätige, dass ich berechtigt bin, diesen Auftrag zu erteilen. Mir ist bewusst, dass ich diese Erklärung elektronisch abgebe und sie rechtsverbindlich ist.";

export function quoteConsentText(quoteNo: string): string {
  return QUOTE_CONSENT_TEXT.replace("{quote_no}", quoteNo);
}
