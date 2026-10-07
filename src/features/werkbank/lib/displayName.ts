export interface DisplayNameInput {
  kind: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** HV: company name. Private: "last, first", or just "last" without a first name. */
export function customerDisplayName(c: DisplayNameInput): string {
  if (c.kind === "property_manager") return c.company_name ?? "";
  const last = c.last_name ?? "";
  return c.first_name ? `${last}, ${c.first_name}` : last;
}
