// GENERATED FILE. Do not edit.
// Source: src/features/werkbank/lib/quotePreflight.ts
// Regenerate: npm run sync:mirrors
// Pure and import-free on purpose: mirrored byte for byte to the edge runtime
// (supabase/functions/_shared/werkbank/quotePreflight.ts, see scripts/mirrors.manifest.json),
// so the send dialog and the werkbank-quotes function check the same rules.

/** The company profile fields the completeness rule reads. */
export type CompanyProfileLike = {
  company_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  tax_number: string | null;
  vat_id: string | null;
};

const filled = (v: string | null | undefined): boolean => typeof v === "string" && v.trim() !== "";

/** A quote may only go out when the profile carries name, address, email and either a tax
 *  number or a VAT id (German invoicing law). */
export function isCompanyProfileComplete(p: CompanyProfileLike | null): boolean {
  if (!p) return false;
  return (
    filled(p.company_name) && filled(p.street) && filled(p.postal_code) && filled(p.city) &&
    filled(p.email) && (filled(p.tax_number) || filled(p.vat_id))
  );
}

export type QuoteBlocker = "profile_incomplete" | "no_items" | "no_recipient" | "valid_until_past";

export interface QuotePreflightInput {
  profile: CompanyProfileLike | null;
  /** Number of priced lines (kind "item"); titles and text lines do not count. */
  itemCount: number;
  recipients: string[];
  /** YYYY-MM-DD */
  validUntil: string;
  /** Today in Europe/Berlin, YYYY-MM-DD. */
  today: string;
}

/** Everything that blocks sending, in a stable order. An empty list means the quote may go out. */
export function quotePreflight(input: QuotePreflightInput): QuoteBlocker[] {
  const blockers: QuoteBlocker[] = [];
  if (!isCompanyProfileComplete(input.profile)) blockers.push("profile_incomplete");
  if (input.itemCount < 1) blockers.push("no_items");
  if (!input.recipients.some(filled)) blockers.push("no_recipient");
  // ISO dates compare lexically; a quote valid until today may still go out.
  if (input.validUntil < input.today) blockers.push("valid_until_past");
  return blockers;
}
