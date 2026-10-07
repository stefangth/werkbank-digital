// Registers the embedded Geist family for the Werkbank quote PDF. Werkbank does not import
// from _shared/hire-order-pdf; the bytes come from the neutral _shared/pdf mirror pair.
import { Font } from "npm:@react-pdf/renderer@^4";
import { inflateFontGzB64 } from "../../pdf/fontInflate.ts";
import {
  GEIST_MEDIUM_GZ_B64,
  GEIST_REGULAR_GZ_B64,
  GEIST_SEMIBOLD_GZ_B64,
} from "../../pdf/fonts.ts";

let registration: Promise<void> | null = null;

/** Registers Geist once per isolate. Async because the fonts are stored gzipped. A failed
 *  attempt is not cached, so the next render retries. `inflate` is injectable for tests. */
export function registerQuoteFonts(inflate: (gzB64: string) => Promise<string> = inflateFontGzB64): Promise<void> {
  registration ??= (async () => {
    const [regular, medium, semibold] = await Promise.all([
      inflate(GEIST_REGULAR_GZ_B64),
      inflate(GEIST_MEDIUM_GZ_B64),
      inflate(GEIST_SEMIBOLD_GZ_B64),
    ]);
    Font.register({
      family: "Geist",
      fonts: [
        { src: `data:font/ttf;base64,${regular}`, fontWeight: 400 },
        { src: `data:font/ttf;base64,${medium}`, fontWeight: 500 },
        { src: `data:font/ttf;base64,${semibold}`, fontWeight: 600 },
      ],
    });
    // Names and street lines are not dictionary words: break on whole words only.
    Font.registerHyphenationCallback((word) => [word]);
  })().catch((e) => {
    registration = null;
    throw e;
  });
  return registration;
}
