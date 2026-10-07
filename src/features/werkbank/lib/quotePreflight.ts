// Pure and import-free on purpose: a later task mirrors this file to the edge runtime.

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
