// GENERATED FILE. Do not edit.
// Source: src/features/werkbank/lib/quoteDisplayNumber.ts
// Regenerate: npm run sync:mirrors
// Pure and import-free on purpose: mirrored byte for byte to the edge runtime
// (supabase/functions/_shared/werkbank/quoteDisplayNumber.ts, see scripts/mirrors.manifest.json),
// so the app, the PDF, the emails and the public page print the same number.

/** `A-0042` for version 1, `A-0042-2` from version 2. */
export function formatQuoteNumber(quoteNo: string, version: number): string {
  return version > 1 ? `${quoteNo}-${version}` : quoteNo;
}
