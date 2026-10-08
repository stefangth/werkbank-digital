// GENERATED FILE. Do not edit.
// Source: src/features/werkbank/lib/defaultRecipient.ts
// Regenerate: npm run sync:mirrors
/** The prefilled recipient of a document email: the customer's invoice address, else the contact's,
 *  else the customer's general address. Blank values are skipped; empty string when none.
 *  Pure and import-free: it is mirrored to the edge runtime (scripts/mirrors.manifest.json). */
export function defaultRecipient(
  customer: { invoice_email?: string | null; email?: string | null } | null,
  contact: { email?: string | null } | null,
): string {
  return customer?.invoice_email?.trim() || contact?.email?.trim() || customer?.email?.trim() || "";
}
