// GENERATED FILE. Do not edit.
// Source: src/features/werkbank/lib/invoicePreflight.ts
// Regenerate: npm run sync:mirrors
// Mirrored to the edge runtime (supabase/functions/_shared/werkbank/invoicePreflight.ts, see
// scripts/mirrors.manifest.json), together with quotePreflight.ts, so the relative import
// resolves in both runtimes. The issue dialog and werkbank-invoices check the same blockers.
import { isCompanyProfileComplete, type CompanyProfileLike } from "./quotePreflight";

export type InvoiceBlocker =
  | "no_items"
  | "no_service_date"
  | "profile_incomplete"
  | "no_buyer_address"
  | "no_recipient";

export interface InvoicePreflightInput {
  profile: (CompanyProfileLike & { iban: string | null }) | null;
  /** Number of priced lines (kind "item"). */
  itemCount: number;
  serviceDateFrom: string | null;
  buyer: { street: string | null; postal_code: string | null; city: string | null } | null;
  /** null means "issue without sending": the recipient rule is skipped. */
  recipients: string[] | null;
}

const filled = (v: string | null | undefined): boolean => typeof v === "string" && v.trim() !== "";

/** Everything that blocks issuing (or sending) an invoice, in a stable order. */
export function invoicePreflight(input: InvoicePreflightInput): InvoiceBlocker[] {
  const blockers: InvoiceBlocker[] = [];
  const { profile, buyer } = input;
  if (input.itemCount < 1) blockers.push("no_items");
  if (!filled(input.serviceDateFrom)) blockers.push("no_service_date");
  if (!isCompanyProfileComplete(profile) || !filled(profile?.iban)) blockers.push("profile_incomplete");
  if (!buyer || !filled(buyer.street) || !filled(buyer.postal_code) || !filled(buyer.city)) blockers.push("no_buyer_address");
  if (input.recipients !== null && !input.recipients.some(filled)) blockers.push("no_recipient");
  return blockers;
}
